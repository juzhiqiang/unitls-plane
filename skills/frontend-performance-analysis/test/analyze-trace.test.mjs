import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeTraceEvents,
  categoryOf,
  formatCompareReport,
  formatReport,
} from '../analyze-trace.mjs';

describe('analyze-trace.mjs 核心准确性与回归测试', () => {
  it('P0-1 & P0-2: RunTask 不计入 Scripting,普通 Layout 不误报为强制同步布局', () => {
    assert.equal(categoryOf('RunTask'), 'System');
    assert.equal(categoryOf('ParseAuthorStyleSheet'), 'Rendering');
    assert.equal(categoryOf('ParseHTML'), 'Loading');
    assert.equal(categoryOf('FunctionCall'), 'Scripting');

    const events = [
      { ph: 'M', pid: 10, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      // 1) 正常渲染帧中的 Layout (父级是 RunTask,而非 JS 执行函数) → 不应算作 forcedLayout
      { ph: 'X', pid: 10, tid: 1, name: 'RunTask', ts: 100000, dur: 20000 },
      { ph: 'X', pid: 10, tid: 1, name: 'Layout', ts: 105000, dur: 5000 },
      // 2) JS FunctionCall 内部同步触发的 Layout → 应算作 forcedLayout
      { ph: 'X', pid: 10, tid: 1, name: 'RunTask', ts: 130000, dur: 30000 },
      { ph: 'X', pid: 10, tid: 1, name: 'FunctionCall', ts: 132000, dur: 25000 },
      { ph: 'X', pid: 10, tid: 1, name: 'Layout', ts: 140000, dur: 6000 },
      // 3) 带有 beginData.stackTrace 的 Layout → 应算作 forcedLayout
      {
        ph: 'X',
        pid: 10,
        tid: 1,
        name: 'Layout',
        ts: 170000,
        dur: 4000,
        args: { beginData: { stackTrace: [{ functionName: 'measureDom' }] } },
      },
    ];

    const res = analyzeTraceEvents(events);
    assert.equal(res.domStats.layoutCount, 3);
    assert.equal(res.domStats.forcedLayout, 2, '只有 JS 栈内或带 stackTrace 的 Layout 才计入强制同步布局');
    // FunctionCall 总长 25ms,减去内部 Layout 6ms = Scripting 19ms
    assert.equal(res.catTotals.Scripting, 19000);
    // Layout 共 5ms + 6ms + 4ms = 15ms
    assert.equal(res.catTotals.Rendering, 15000);
  });

  it('P0-3: Profile startTime 不会被晚到的 ProfileChunk.ts 覆盖,--window 钻取时间准确', () => {
    const events = [
      { ph: 'M', pid: 1, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'X', pid: 1, tid: 1, name: 'RunTask', ts: 100000, dur: 200000 },
      // Profile 声明真实起点为 100,000us
      { ph: 'P', pid: 1, tid: 1, id: '0x1', name: 'Profile', ts: 100000, args: { data: { startTime: 100000 } } },
      // ProfileChunk 在 250,000us 才批量刷出,但对应的是 100,000us 之后前 30ms 的采样
      {
        ph: 'P',
        pid: 1,
        tid: 1,
        id: '0x1',
        name: 'ProfileChunk',
        ts: 250000,
        args: {
          data: {
            cpuProfile: {
              nodes: [
                { id: 1, callFrame: { functionName: '(root)' } },
                { id: 2, parent: 1, callFrame: { functionName: 'earlyHotspot', url: 'https://a.local/app.js', lineNumber: 9 } },
              ],
              samples: [2, 2],
            },
            timeDeltas: [10000, 15000],
          },
        },
      },
    ];

    // 钻取 +0ms ~ +40ms (即 100,000us ~ 140,000us)
    const res = analyzeTraceEvents(events, { window: '0-40' });
    assert.ok(res.windowDrill?.cpuAgg, '应包含时间窗 CPU 聚合结果');
    assert.equal(res.windowDrill.cpuAgg.activeUs, 25000, '采样应落在 0~40ms 窗口内而非被推迟到 250,000us 之后');
  });

  it('P0-4 & P0-8: 多进程 Trace 自动锁定目标页面 pid 并隔离 UpdateCounters 与解析 gpuMemoryUsedKB', () => {
    const events = [
      // 插件进程 pid=99 (排在前面,且有干扰计数器)
      { ph: 'M', pid: 99, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'X', pid: 99, tid: 1, name: 'RunTask', ts: 100000, dur: 10000 },
      {
        ph: 'I',
        pid: 99,
        tid: 1,
        name: 'UpdateCounters',
        ts: 105000,
        args: { data: { jsHeapSizeUsed: 999 * 1024 * 1024, nodes: 99999 } },
      },
      // 真实业务页面进程 pid=200 (由 TracingStartedInBrowser 标记)
      {
        ph: 'I',
        pid: 1,
        tid: 1,
        name: 'TracingStartedInBrowser',
        ts: 100000,
        args: { data: { frames: [{ processId: 200, url: 'https://example.com/3d-viewer' }] } },
      },
      { ph: 'M', pid: 200, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'X', pid: 200, tid: 1, name: 'FunctionCall', ts: 110000, dur: 80000 },
      {
        ph: 'I',
        pid: 200,
        tid: 1,
        name: 'UpdateCounters',
        ts: 120000,
        args: { data: { jsHeapSizeUsed: 40 * 1024 * 1024, nodes: 500, gpuMemoryUsedKB: 102400 } }, // 100MB in KB
      },
    ];

    const res = analyzeTraceEvents(events);
    assert.equal(res.mainPid, 200, '应锁定 TracingStartedInBrowser 指向的页面进程 pid=200');
    assert.equal(res.counters.heap.max, 40 * 1024 * 1024, '不应混入插件进程 pid=99 的 999MB 堆内存');
    assert.equal(res.counters.gpuMem.max, 100 * 1024 * 1024, 'gpuMemoryUsedKB (102400KB) 应正确转换为 100MB 字节数');
  });

  it('P0-5 & P0-6: 3D 调用栈向上回溯父节点归因,且纯 2D 页面不误报 3D 渲染章节', () => {
    const events3D = [
      { ph: 'M', pid: 1, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'X', pid: 1, tid: 1, name: 'FireAnimationFrame', ts: 100000, dur: 30000 },
      { ph: 'P', pid: 1, tid: 1, id: '0x1', name: 'Profile', ts: 100000, args: { data: { startTime: 100000 } } },
      {
        ph: 'P',
        pid: 1,
        tid: 1,
        id: '0x1',
        name: 'ProfileChunk',
        ts: 130000,
        args: {
          data: {
            cpuProfile: {
              nodes: [
                { id: 1, callFrame: { functionName: '(root)' } },
                { id: 2, parent: 1, callFrame: { functionName: 'intersectObjects' } },
                { id: 3, parent: 2, callFrame: { functionName: 'subVectors' } }, // 叶子是纯数学函数
              ],
              samples: [3, 3],
            },
            timeDeltas: [12000, 14000],
          },
        },
      },
    ];

    const res3D = analyzeTraceEvents(events3D);
    assert.equal(res3D.gpu3D.raycastUs, 26000, '叶子函数 subVectors 的耗时应沿调用栈归因到祖先 intersectObjects (raycast)');
    assert.equal(res3D.gpu3D.hasExplicit3DSignals, true);

    // 纯 2D 页面仅有极少量合成 GPUTask
    const events2D = [
      { ph: 'M', pid: 1, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'X', pid: 1, tid: 1, name: 'FunctionCall', ts: 100000, dur: 50000 },
      { ph: 'X', pid: 1, tid: 2, name: 'GPUTask', ts: 110000, dur: 1000 },
    ];
    const res2D = analyzeTraceEvents(events2D);
    assert.equal(res2D.gpu3D.hasExplicit3DSignals, false);
    const report2D = formatReport(res2D, '2d.json');
    assert.ok(!report2D.includes('[GPU / 3D 渲染管线与纹理解码]'), '纯 2D 轻量合成不应打印 3D 渲染管线章节');
  });

  it('P0-9: 静态页面空闲休眠间隔 (>250ms 且无长任务阻塞) 不计入掉帧', () => {
    const events = [
      { ph: 'M', pid: 1, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'X', pid: 1, tid: 1, name: 'DrawFrame', ts: 100000, dur: 100 },
      { ph: 'X', pid: 1, tid: 1, name: 'DrawFrame', ts: 116000, dur: 100 }, // +16ms
      { ph: 'X', pid: 1, tid: 1, name: 'DrawFrame', ts: 132000, dur: 100 }, // +16ms
      // 中间静止 500ms 无任何长任务
      { ph: 'X', pid: 1, tid: 1, name: 'DrawFrame', ts: 632000, dur: 100 },
      { ph: 'X', pid: 1, tid: 1, name: 'DrawFrame', ts: 648000, dur: 100 }, // +16ms
      // PipelineReporter 掉帧统计
      {
        ph: 'X',
        pid: 1,
        tid: 1,
        name: 'PipelineReporter',
        ts: 116000,
        dur: 16000,
        args: { chrome_frame_reporter: { state: 'STATE_DROPPED' } },
      },
      {
        ph: 'X',
        pid: 1,
        tid: 1,
        name: 'PipelineReporter',
        ts: 132000,
        dur: 16000,
        args: { chrome_frame_reporter: { state: 'STATE_PRESENTED_ALL' } },
      },
    ];

    const res = analyzeTraceEvents(events);
    assert.equal(res.frameStats.idleGapCount, 1, '500ms 静态空闲应识别为休眠间隔');
    assert.equal(res.frameStats.count, 3, '有效活跃帧间隔应为 3 个 (均为 16ms)');
    assert.equal(res.frameStats.longFramesBudget, 0, '剔除静态休眠后不应误报掉帧');
    assert.equal(res.frameStats.estFps, 62.5);
    assert.equal(res.frameStats.pipelineDropped, 1);
    assert.equal(res.frameStats.pipelinePresented, 1);
  });

  it('P1: 支持 B/E 成对事件、Web Vitals (LCP/CLS/INP)、Worker 热点与 --compare 对比报告', () => {
    const beforeEvents = [
      { ph: 'M', pid: 1, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'M', pid: 1, tid: 2, name: 'thread_name', args: { name: 'DedicatedWorkerThread' } },
      // B/E 成对事件代表 80ms FunctionCall
      { ph: 'B', pid: 1, tid: 1, name: 'FunctionCall', ts: 100000 },
      { ph: 'E', pid: 1, tid: 1, name: 'FunctionCall', ts: 180000 },
      // Web Vitals
      {
        ph: 'I',
        pid: 1,
        tid: 1,
        name: 'largestContentfulPaint::Candidate',
        ts: 2200000,
        args: { data: { size: 48000 } },
      },
      {
        ph: 'I',
        pid: 1,
        tid: 1,
        name: 'LayoutShift',
        ts: 150000,
        args: { data: { score: 0.15, had_recent_input: false } },
      },
      {
        ph: 'X',
        pid: 1,
        tid: 1,
        name: 'EventTiming',
        ts: 120000,
        dur: 240000,
        args: { data: { type: 'click' } },
      },
      // Worker 采样
      {
        ph: 'P',
        pid: 1,
        tid: 2,
        id: '0x2',
        name: 'ProfileChunk',
        ts: 150000,
        args: {
          data: {
            cpuProfile: {
              nodes: [
                { id: 1, callFrame: { functionName: '(root)' } },
                { id: 2, parent: 1, callFrame: { functionName: 'decodeDracoMesh', url: 'https://a.local/worker.js' } },
              ],
              samples: [2],
            },
            timeDeltas: [35000],
          },
        },
      },
    ];

    const afterEvents = [
      { ph: 'M', pid: 1, tid: 1, name: 'thread_name', args: { name: 'CrRendererMain' } },
      { ph: 'X', pid: 1, tid: 1, name: 'FunctionCall', ts: 100000, dur: 20000 },
    ];

    const beforeRes = analyzeTraceEvents(beforeEvents);
    const afterRes = analyzeTraceEvents(afterEvents);

    assert.equal(beforeRes.catTotals.Scripting, 80000, 'B/E 事件应合成为 80ms Scripting');
    assert.equal(beforeRes.longTasks.length, 1);
    assert.equal(beforeRes.webVitals.clsScore, 0.15);
    assert.equal(beforeRes.webVitals.worstInteraction?.dur, 240000);
    assert.equal(beforeRes.workerProfiles.length, 1);
    assert.equal(beforeRes.workerProfiles[0]. activeUs, 35000);

    const cmpText = formatCompareReport(beforeRes, afterRes, 'before.json', 'after.json');
    assert.ok(cmpText.includes('✅ 改善'), '对比报告应输出改善标记');
  });
});
