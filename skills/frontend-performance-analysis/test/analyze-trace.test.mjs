import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  analyzeTraceEvents,
  categoryOf,
  formatCompareReport,
  formatReport,
  loadTrace,
  parseTraceIncrementally,
} from '../analyze-trace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('analyze-trace.mjs 真实 Chromium Trace 格式与核心准确性测试', () => {
  it('P0-1: 未知子事件(如 GLES2::ReadPixels)继承父级 Scripting 类别,且嵌套 GPU 同步等待不重复累加', () => {
    assert.equal(categoryOf('RunTask'), 'System');
    assert.equal(categoryOf('GLES2::ReadPixels', 'Scripting'), 'Scripting');
    assert.equal(categoryOf('ParseAuthorStyleSheet'), 'Rendering');
    assert.equal(categoryOf('ParseHTML'), 'Loading');

    const events = [
      { ph: 'M', pid: 10, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'X', pid: 10, tid: 1, name: 'RunTask', ts: 100000, dur: 100000 },
      { ph: 'X', pid: 10, tid: 1, name: 'FireAnimationFrame', ts: 101000, dur: 98000 },
      {
        ph: 'X',
        pid: 10,
        tid: 1,
        name: 'FunctionCall',
        ts: 102000,
        dur: 96000,
        args: { data: { functionName: 'renderLoop' } },
      },
      // 真实 Chromium 中 GLES2::ReadPixels 内部嵌套 CommandBufferHelper::Finish 与 ImplementationBase::WaitForCmd
      { ph: 'X', pid: 10, tid: 1, name: 'GLES2::ReadPixels', ts: 105000, dur: 90000 },
      { ph: 'X', pid: 10, tid: 1, name: 'CommandBufferHelper::Finish', ts: 105100, dur: 89800 },
      { ph: 'X', pid: 10, tid: 1, name: 'ImplementationBase::WaitForCmd', ts: 105200, dur: 89500 },
      // 普通 Layout (不在 JS 栈内) vs JS 栈内强制同步布局
      { ph: 'X', pid: 10, tid: 1, name: 'Layout', ts: 196000, dur: 1500 },
      { ph: 'X', pid: 10, tid: 1, name: 'RunTask', ts: 210000, dur: 10000 },
      { ph: 'X', pid: 10, tid: 1, name: 'Layout', ts: 212000, dur: 3000 },
    ];

    const res = analyzeTraceEvents(events);
    // FireAnimationFrame (98ms) 中除 1.5ms Layout 外均为 Scripting (96.5ms),绝不能因 GLES2::ReadPixels 变成 System
    assert.equal(res.catTotals.Scripting, 96500);
    assert.equal(res.catTotals.Rendering, 4500);
    assert.equal(res.domStats.forcedLayout, 1);
    // 嵌套的 3 层 GPU 同步等待只按最外层 GLES2::ReadPixels 计 1 次 (90ms),不翻 3 倍
    assert.equal(res.gpu3D.gpuSyncStallUs, 90000);
    // LongTask 应生成主导调用链
    assert.equal(res.longTasks.length, 1);
    assert.ok(
      res.longTasks[0].chain.includes('RunTask → FireAnimationFrame → renderLoop → GLES2::ReadPixels'),
      `实际主导链: ${res.longTasks[0].chain}`
    );
  });

  it('P0-2 & P0-3: Profile(主线程)与 ProfileChunk(V8 采样线程)跨 tid 关联不误报假 Worker,且 --window 时间准确', () => {
    const events = [
      { ph: 'M', pid: 39484, tid: 16740, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'M', pid: 39484, tid: 7448, name: 'thread_name', args: { name: 'CompositorTileWorker1' } },
      { ph: 'M', pid: 39484, tid: 28888, name: 'thread_name', args: { name: 'DedicatedWorker thread' } },
      { ph: 'X', pid: 39484, tid: 16740, name: 'RunTask', ts: 100000, dur: 200000 },
      // Profile 在主线程 tid=16740,而 ProfileChunk 在采样线程 tid=19780
      {
        ph: 'P',
        pid: 39484,
        tid: 16740,
        id: '0x1',
        name: 'Profile',
        ts: 100000,
        args: { data: { startTime: 100000 } },
      },
      {
        ph: 'P',
        pid: 39484,
        tid: 19780,
        id: '0x1',
        name: 'ProfileChunk',
        ts: 250000,
        args: {
          data: {
            cpuProfile: {
              nodes: [
                { id: 1, callFrame: { functionName: '(root)' } },
                { id: 2, parent: 1, callFrame: { functionName: 'intersectObjects' } },
                { id: 3, parent: 2, callFrame: { functionName: 'intersectTriangle', url: 'https://a.local/bvh.js', lineNumber: 19 } },
              ],
              samples: [3, 3],
            },
            timeDeltas: [12000, 18000],
          },
        },
      },
    ];

    const res = analyzeTraceEvents(events, { window: '0-40' });
    assert.equal(res.mainProfileTid, 16740);
    assert.equal(res.cpuActiveUs, 30000);
    assert.equal(res.gpu3D.raycastUs, 30000, '叶子函数 intersectTriangle 应归因到 raycast');
    assert.equal(res.workerProfiles.length, 0, '采样器线程 tid=19780 绝不能被当成 Worker 重复输出');
    assert.equal(res.windowDrill?.cpuActiveUs, 30000, 'startTime 未被 chunk.ts 覆盖,0-40ms 窗口应完整命中');
  });

  it('P0-3 ~ P0-7: 真实 EventTiming(ph:b 三阶段拆解)、PipelineReporter(frame_reporter)、GPUTask.used_bytes、LCP 导航基准与会话窗口 CLS', () => {
    const events = [
      {
        ph: 'I',
        pid: 1,
        tid: 1,
        name: 'TracingStartedInBrowser',
        ts: 100000,
        args: { data: { frames: [{ processId: 200, isOutermostMainFrame: true, url: 'about:blank' }] } },
      },
      { ph: 'M', pid: 200, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'M', pid: 300, tid: 2, name: 'thread_name', args: { name: 'CrGpuMain' } },
      { ph: 'X', pid: 200, tid: 1, name: 'FunctionCall', ts: 100000, dur: 50000 },
      // 真实 GPUTask 携带 renderer_pid 与 used_bytes
      {
        ph: 'X',
        pid: 300,
        tid: 2,
        name: 'GPUTask',
        ts: 110000,
        dur: 8000,
        args: { data: { renderer_pid: 200, used_bytes: 16 * 1024 * 1024 } },
      },
      {
        ph: 'X',
        pid: 300,
        tid: 2,
        name: 'GPUTask',
        ts: 140000,
        dur: 9000,
        args: { data: { renderer_pid: 200, used_bytes: 32 * 1024 * 1024 } },
      },
      // 真实 PipelineReporter (args.frame_reporter, 且混有 Browser 进程 pid=1 的干扰事件)
      {
        ph: 'b',
        pid: 200,
        tid: 5,
        name: 'PipelineReporter',
        ts: 110000,
        args: { frame_reporter: { state: 'STATE_DROPPED' } },
      },
      {
        ph: 'b',
        pid: 200,
        tid: 5,
        name: 'PipelineReporter',
        ts: 126000,
        args: { frame_reporter: { state: 'STATE_PRESENTED_ALL' } },
      },
      {
        ph: 'b',
        pid: 1,
        tid: 1,
        name: 'PipelineReporter',
        ts: 126000,
        args: { frame_reporter: { state: 'STATE_DROPPED' } },
      },
      // 真实 EventTiming (ph:'b', interactionId=0 的 pointerover 应忽略, interactionId>0 的 pointerdown 拆解三阶段)
      {
        ph: 'b',
        pid: 200,
        tid: 1,
        name: 'EventTiming',
        ts: 115000,
        args: {
          data: {
            type: 'pointerover',
            interactionId: 0,
            duration: 900,
          },
        },
      },
      {
        ph: 'b',
        pid: 200,
        tid: 1,
        name: 'EventTiming',
        ts: 120000,
        args: {
          data: {
            type: 'pointerdown',
            interactionId: 42,
            duration: 320.5,
            timeStamp: 100.0,
            processingStart: 180.0,
            processingEnd: 220.5,
          },
        },
      },
      // 会话窗口 CLS: 前两次间隔 0.2s 在同一窗口 (0.12 + 0.08 = 0.20), 第 3 次间隔 3s 开启新窗口 (0.05)
      {
        ph: 'I',
        pid: 200,
        tid: 1,
        name: 'LayoutShift',
        ts: 100000,
        args: { data: { weighted_score_delta: 0.12, had_recent_input: false } },
      },
      {
        ph: 'I',
        pid: 200,
        tid: 1,
        name: 'LayoutShift',
        ts: 300000,
        args: { data: { weighted_score_delta: 0.08, had_recent_input: false } },
      },
      {
        ph: 'I',
        pid: 200,
        tid: 1,
        name: 'LayoutShift',
        ts: 4000000,
        args: { data: { weighted_score_delta: 0.05, had_recent_input: false } },
      },
      // 无 navigationStart 时的 LCP 候选
      {
        ph: 'R',
        pid: 200,
        tid: 1,
        name: 'largestContentfulPaint::Candidate',
        ts: 3500000,
        args: { data: { size: 2048, navigationId: 'nav-1' } },
      },
    ];

    const res = analyzeTraceEvents(events);
    assert.equal(res.mainPid, 200);
    assert.equal(res.counters.gpuMem.start, 16 * 1024 * 1024);
    assert.equal(res.counters.gpuMem.max, 32 * 1024 * 1024);
    assert.equal(res.counters.gpuMem.source, 'GPUTask.used_bytes');
    assert.equal(res.frameStats.pipelineDropped, 1, '只统计渲染进程 pid=200 的 PipelineReporter');
    assert.equal(res.frameStats.pipelinePresented, 1);

    const inp = res.webVitals.worstInteraction;
    assert.ok(inp);
    assert.equal(inp.type, 'pointerdown');
    assert.equal(inp.dur, 320500);
    assert.equal(inp.inputDelayUs, 80000);
    assert.equal(inp.processingUs, 40500);
    assert.equal(inp.presentationDelayUs, 200000);

    assert.ok(Math.abs(res.webVitals.clsScore - 0.2) < 1e-6, `CLS 应取最大会话窗口 0.20 而非全量累加 0.25`);
    assert.equal(res.webVitals.lcpCandidate?.hasNavStart, false);
  });

  it('P1: parseTraceIncrementally 流式解析兼容前置 metadata 数组,且 --json 完整序列化热点数组', () => {
    const rawJson = JSON.stringify({
      metadata: {
        source: 'DevTools',
        tags: ['x', 'y', 'z'],
        nested: { arr: [1, 2, 3] },
      },
      traceEvents: [
        { ph: 'M', pid: 1, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
        {
          ph: 'X',
          pid: 1,
          tid: 1,
          name: 'FunctionCall',
          ts: 10000,
          dur: 45000,
          args: { data: { functionName: 'heavyWork', url: 'https://a.local/main.js' } },
        },
      ],
    });
    const parsed = parseTraceIncrementally(Buffer.from(rawJson, 'utf8'));
    assert.equal(parsed.length, 2);

    const res = analyzeTraceEvents(parsed);
    const jsonStr = JSON.stringify(res);
    const hydrated = JSON.parse(jsonStr);
    assert.ok(Array.isArray(hydrated.fallbackHotspots));
    assert.equal(hydrated.fallbackHotspots.length, 1);
    assert.ok(hydrated.fallbackHotspots[0].name.includes('heavyWork'));

    // 验证 --compare 归一化与 ±5% 噪声带
    const cmpSame = formatCompareReport(res, res, 'a.json', 'b.json');
    assert.ok(cmpSame.includes('≈ 持平(±5%内)'));
  });

  it('真实 Chromium WebGL 录制 Fixture 端到端回归验证 (real-chromium-webgl.json.gz)', () => {
    const fixturePath = join(__dirname, 'fixtures', 'real-chromium-webgl.json.gz');
    const events = loadTrace(fixturePath);
    const res = analyzeTraceEvents(events, { top: 5 });

    assert.equal(res.mainPid, 39484);
    assert.equal(res.mainTid, 16740);
    assert.ok(res.catTotals.Scripting > res.catTotals.System, '真实 Trace 中 Scripting 应远大于 System');
    assert.ok(res.cpuHotspots.length > 0, '应解析出真实 CPU 采样热点');
    assert.equal(res.cpuHotspots[0].name, 'readPixels');
    assert.equal(res.workerProfiles.length, 0, '无 Web Worker 的真实页面不应出现假 Worker');
    assert.ok(res.domStats.forcedLayout > 0, '应识别出带 beginData.stackTrace 的强制同步布局');
    assert.ok(res.frameStats.pipelineDropped > 0, '应识别出真实 frame_reporter 掉帧');
    assert.ok(res.counters.gpuMem.max > 0, '应从 GPUTask.used_bytes 提取出显存峰值');
    assert.ok(res.webVitals.worstInteraction?.inputDelayUs != null, '应拆解出真实 EventTiming 三阶段耗时');

    const report = formatReport(res, fixturePath, 5);
    assert.ok(report.includes('RunTask → FireAnimationFrame → renderLoop → GLES2::ReadPixels'));
    assert.ok(report.includes('[GPUTask.used_bytes]'));
  });
});
