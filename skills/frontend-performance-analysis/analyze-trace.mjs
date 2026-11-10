#!/usr/bin/env node
// analyze-trace.mjs — Chrome DevTools Performance trace 全程分析器(纯 Node,零依赖)
//
// 用途:把几十 MB 的 trace 聚合成几十行高信号结论,绝不把原始事件塞进对话上下文。
// 覆盖:普通 2D 网页 + 3D 场景(WebGL / WebGPU / Three.js / Canvas / WASM)。
// 用法:
//   node analyze-trace.mjs <trace.json | trace.json.gz> [--top N] [--tid <id>] [--window START-END]
//   --top N            每个排行榜显示前 N 项(默认 15)
//   --tid <id>         只统计指定线程 id(默认自动锁定 CrRendererMain 主线程)
//   --window START-END 钻取相对 trace 起点 START~END 毫秒的时间窗(同时过滤 X 事件与 CPU 采样)
//
// 输入:Chrome 性能面板导出的 trace。兼容顶层数组和 { traceEvents: [...] }。
// 输出:主线程时间总账 / Long Tasks / JS self-time 热点 / rAF 动画帧与帧率 /
//      GPU 与 3D 管线信号 / 渲染与布局抖动 / GC 与内存・DOM 计数器趋势 / 线程忙碌占比 / 自动优化建议。

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function parseArgs(argv) {
  const args = { file: null, top: 15, tid: null, window: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') args.top = Math.max(1, parseInt(argv[++i], 10) || 15);
    else if (a === '--tid') args.tid = argv[++i];
    else if (a === '--window') args.window = argv[++i]; // "START-END" 毫秒,相对 trace 起点
    else if (!a.startsWith('--')) args.file = a;
  }
  return args;
}

function loadTrace(file) {
  let buf = readFileSync(file);
  if (file.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b)) {
    buf = gunzipSync(buf);
  }
  const json = JSON.parse(buf.toString('utf8'));
  const events = Array.isArray(json) ? json : json.traceEvents;
  if (!Array.isArray(events)) {
    throw new Error('无法识别的 trace 格式:既不是数组也没有 traceEvents');
  }
  return events;
}

const fmtMs = (us) => (us / 1000).toFixed(1) + 'ms';
const fmtMB = (bytes) => (bytes / (1024 * 1024)).toFixed(1) + 'MB';
const pct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(1) : '0.0') + '%';

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

// Chrome trace 里 name 到高层类别的粗分类
function categoryOf(name) {
  if (/(RunMicrotasks|FunctionCall|EvaluateScript|v8|CompileScript|ParseAuthor|MinorGC|MajorGC|GCEvent|RunTask|TimerFire|EventDispatch|FireAnimationFrame|XHR|RunMicro)/.test(name)) {
    if (/GC/.test(name)) return 'GC';
    return 'Scripting';
  }
  if (/(Layout|RecalculateStyles|UpdateLayoutTree|ScheduleStyleRecalculation|InvalidateLayout|HitTest|PrePaint)/.test(name)) return 'Rendering';
  if (/(Paint|Raster|CompositeLayers|Draw|Decode|Resize|GPUTask|CommandBuffer|Image|Commit)/.test(name)) return 'Painting';
  return 'System';
}

// 判断是否为录制器自身开销或浏览器内部伪帧
function isProfilerArtifact(fnName) {
  return /^(CpuProfiler::StartProfiling|V8\.HandleInterrupts|\(idle\)|\(program\)|\(root\))$/.test(fnName || '');
}

// 3D / WebGL / WebGPU 相关的函数或事件特征分类
function classify3DSignal(name) {
  if (!name) return null;
  if (/(compileShader|linkProgram|ShaderCompile|ProgramLink|getProgramParameter|getShaderParameter|createShaderProgram)/i.test(name)) {
    return 'shaderCompile';
  }
  if (/(readPixels|getError|glFinish|\bfinish\b|waitSync|clientWaitSync|mapAsync|getBufferSubData)/i.test(name)) {
    return 'gpuSyncStall';
  }
  if (/(texImage2D|texSubImage2D|compressedTexImage2D|Decode Image|ImageDecodeTask|createImageBitmap|uploadTexture)/i.test(name)) {
    return 'textureUploadDecode';
  }
  if (/(raycast|intersectObject|intersectObjects)/i.test(name)) {
    return 'raycast';
  }
  if (/(drawElements|drawArrays|drawElementsInstanced|drawArraysInstanced|renderBufferDirect|projectObject|WebGLRenderingContext)/i.test(name)) {
    return 'drawSubmission';
  }
  return null;
}

function main() {
  const { file, top, tid: forcedTid, window: windowArg } = parseArgs(process.argv);
  if (!file) {
    console.error('用法: node analyze-trace.mjs <trace.json|.json.gz> [--top N] [--tid id] [--window START-END]');
    process.exit(1);
  }

  const events = loadTrace(file);

  // 1. 扫描线程名、时间跨度与各线程 X 事件忙碌度
  const threadBusy = new Map(); // tid -> total top-level dur(us)
  const threadName = new Map(); // tid -> name
  let traceMin = Infinity;
  let traceMax = -Infinity;
  let gpuTid = null;
  let compositorTid = null;

  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name) {
      threadName.set(e.tid, e.args.name);
      if (gpuTid == null && /^CrGpuMain$/i.test(e.args.name)) gpuTid = e.tid;
      if (compositorTid == null && /^Compositor$/i.test(e.args.name)) compositorTid = e.tid;
    }
    // 计算时间跨度:忽略 metadata(ph M)和 ts<=0 的事件,否则 traceMin 会被 ts=0 污染
    if (typeof e.ts === 'number' && e.ts > 0 && e.ph !== 'M') {
      if (e.ts < traceMin) traceMin = e.ts;
      const end = e.ts + (e.dur || 0);
      if (end > traceMax) traceMax = end;
    }
    if (e.ph === 'X' && typeof e.dur === 'number') {
      threadBusy.set(e.tid, (threadBusy.get(e.tid) || 0) + e.dur);
    }
  }

  // 选主线程:优先按名字锁定渲染主线程(CrRendererMain),否则退化到最忙的 X 事件线程
  let mainTid;
  if (forcedTid != null) {
    mainTid = Number(forcedTid);
  } else {
    for (const [tid, name] of threadName) {
      if (name === 'CrRendererMain') { mainTid = tid; break; }
    }
    if (mainTid == null) mainTid = [...threadBusy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  const spanUs = Math.max(1, traceMax - traceMin);

  // 解析 --window START-END (毫秒)
  let winStartUs = null;
  let winEndUs = null;
  let winStartMs = null;
  let winEndMs = null;
  if (windowArg) {
    const [s, e2] = windowArg.split('-').map(Number);
    if (Number.isFinite(s) && Number.isFinite(e2) && e2 > s) {
      winStartMs = s;
      winEndMs = e2;
      winStartUs = traceMin + s * 1000;
      winEndUs = traceMin + e2 * 1000;
    }
  }

  // 2. 解析现代 trace 的 Profile / ProfileChunk (带 tid 隔离 + 采样级时间戳推算)
  // 结构: 每个 profile 线程维护独立节点表和滚动时钟 cursorTs,从而支持按主线程/Worker 拆分及 --window 钻取
  const profileByTid = new Map(); // tid -> { nodes: Map<id, callFrame>, cursorTs: number, samples: Array<{ts, dt, id}> }
  const getProfileState = (tid, initTs) => {
    let st = profileByTid.get(tid);
    if (!st) {
      st = { nodes: new Map(), cursorTs: initTs || traceMin, samples: [] };
      profileByTid.set(tid, st);
    } else if (initTs && st.samples.length === 0) {
      st.cursorTs = initTs;
    }
    return st;
  };

  for (const e of events) {
    if (e.name !== 'Profile' && e.name !== 'ProfileChunk') continue;
    const data = e.args?.data;
    if (!data) continue;
    const tid = e.tid ?? mainTid;
    const startTs = data.startTime ?? (e.ts > 0 ? e.ts : traceMin);
    const st = getProfileState(tid, startTs);

    const cp = data.cpuProfile || data;
    if (cp?.nodes) {
      for (const n of cp.nodes) {
        if (!st.nodes.has(n.id)) st.nodes.set(n.id, n.callFrame || {});
      }
    }
    const samples = cp?.samples;
    const deltas = data.timeDeltas || cp?.timeDeltas;
    if (samples && deltas) {
      // 如果 chunk 自身有有效 ts 且比当前游标更新,适度校准游标起点
      if (typeof e.ts === 'number' && e.ts > traceMin && st.samples.length === 0) {
        st.cursorTs = e.ts;
      }
      for (let i = 0; i < samples.length; i++) {
        const dt = Math.max(0, deltas[i] || 0);
        st.cursorTs += dt;
        st.samples.push({ ts: st.cursorTs, dt, id: samples[i] });
      }
    }
  }

  // 选择用于主线程 CPU Profile 统计的目标 state(优先 mainTid,若为空则选采样最多的线程)
  let mainProfileTid = mainTid;
  if (!profileByTid.get(mainProfileTid)?.samples.length) {
    const ranked = [...profileByTid.entries()].sort((a, b) => b[1].samples.length - a[1].samples.length);
    if (ranked[0]?.[1].samples.length) mainProfileTid = ranked[0][0];
  }
  const mainProfile = profileByTid.get(mainProfileTid);
  const hasCpuProfile = Boolean(mainProfile && mainProfile.samples.length > 0);

  // 聚合某个 profile state 的函数热点(支持时间窗过滤)
  function aggregateProfile(profState, startUs = null, endUs = null) {
    const byFn = new Map(); // key -> us
    const signals3D = { shaderCompile: 0, gpuSyncStall: 0, textureUploadDecode: 0, raycast: 0, drawSubmission: 0 };
    let sampledUs = 0;
    let idleUs = 0;
    let gcSampleUs = 0;
    if (!profState) return { byFn, signals3D, sampledUs, idleUs, gcSampleUs, activeUs: 0 };

    for (const s of profState.samples) {
      if (startUs != null && (s.ts < startUs || s.ts > endUs)) continue;
      sampledUs += s.dt;
      const cf = profState.nodes.get(s.id) || {};
      const fn = cf.functionName || '(anonymous)';
      if (isProfilerArtifact(fn)) {
        idleUs += s.dt;
        continue;
      }
      if (fn === '(garbage collector)') {
        gcSampleUs += s.dt;
      }
      const sig = classify3DSignal(fn);
      if (sig) signals3D[sig] += s.dt;

      const url = cf.url || '';
      const loc = url ? '  @' + shortUrl(url) + (cf.lineNumber >= 0 ? ':' + (cf.lineNumber + 1) : '') : '';
      const key = fn + loc;
      byFn.set(key, (byFn.get(key) || 0) + s.dt);
    }
    return {
      byFn,
      signals3D,
      sampledUs,
      idleUs,
      gcSampleUs,
      activeUs: Math.max(0, sampledUs - idleUs),
    };
  }

  const fullCpuAgg = aggregateProfile(mainProfile);

  // 3. 主线程 X 事件细粒度统计
  const catTotals = { Scripting: 0, Rendering: 0, Painting: 0, GC: 0, System: 0 };
  const selfTime = new Map(); // "url:func" -> self us (无 CPU profile 时兜底)
  const longTasks = []; // {name, dur, ts}
  const rafDurs = []; // FireAnimationFrame 每次耗时(us)
  let layoutCount = 0;
  let layoutDur = 0;
  let styleCount = 0;
  let forcedLayout = 0;
  let gcCount = 0;
  let gcDur = 0;

  // 3D / GPU / 解码 X 事件统计(跨主线程与 GPU 线程)
  let gpuTaskCount = 0;
  let gpuTaskDur = 0;
  let imageDecodeCount = 0;
  let imageDecodeDur = 0;
  let shaderEventDur = 0;

  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    if (/^(GPUTask|CommandBuffer)$/i.test(e.name) || (gpuTid != null && e.tid === gpuTid)) {
      if (e.tid === gpuTid || e.name === 'GPUTask') {
        gpuTaskCount++;
        gpuTaskDur += e.dur;
      }
    }
    if (/^(Decode Image|ImageDecodeTask|UploadTexture)$/i.test(e.name)) {
      imageDecodeCount++;
      imageDecodeDur += e.dur;
    }
    if (/(ShaderCompile|ProgramLink|compileShader|linkProgram)/i.test(e.name)) {
      shaderEventDur += e.dur;
    }
  }

  const mainX = events
    .filter((e) => e.ph === 'X' && e.tid === mainTid && typeof e.dur === 'number')
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);

  // 单趟栈遍历:按 self-time(dur 减去子事件 dur)归类,避免嵌套事件重复计入
  const stack = [];
  const settle = (node) => {
    const self = Math.max(0, node.dur - node.childDur);
    const cat = categoryOf(node.name);
    catTotals[cat] = (catTotals[cat] || 0) + self;
    if (!hasCpuProfile && (cat === 'Scripting' || node.ev.args?.data?.functionName)) {
      const fn = node.ev.args?.data?.functionName || node.ev.args?.data?.url || node.name;
      if (!isProfilerArtifact(fn)) {
        const url = node.ev.args?.data?.url || '';
        const key = (fn || '(anonymous)') + (url ? '  @' + shortUrl(url) : '');
        selfTime.set(key, (selfTime.get(key) || 0) + self);
      }
    }
  };

  for (const e of mainX) {
    if (e.name === 'Layout') { layoutCount++; layoutDur += e.dur; }
    if (/RecalculateStyles|UpdateLayoutTree|ScheduleStyleRecalculation/.test(e.name)) styleCount++;
    if (/MajorGC|MinorGC|GCEvent/.test(e.name)) { gcCount++; gcDur += e.dur; }
    if (e.name === 'FireAnimationFrame') { rafDurs.push(e.dur); }

    while (stack.length && stack[stack.length - 1].end <= e.ts) settle(stack.pop());
    const parent = stack[stack.length - 1];
    if (parent) parent.childDur += e.dur;
    else if (e.dur > 50000) {
      const fn = e.args?.data?.functionName || '';
      if (!isProfilerArtifact(fn) && !isProfilerArtifact(e.name)) {
        longTasks.push({ name: e.name, dur: e.dur, ts: e.ts });
      }
    }

    // 强制同步布局粗判:Layout 的父是脚本类
    if (e.name === 'Layout' && parent && categoryOf(parent.name) === 'Scripting') {
      forcedLayout++;
    }

    stack.push({ name: e.name, end: e.ts + e.dur, childDur: 0, dur: e.dur, ev: e });
  }
  while (stack.length) settle(stack.pop());

  // 4. 帧率与长帧统计:避免把不同线程或 BeginFrame/DrawFrame 混在一个数组里导致帧数翻倍
  // 优先级: 1) 主线程/合成线程 DrawFrame  2) 主线程 FireAnimationFrame 起点  3) 主线程 BeginFrame
  let frameSource = 'DrawFrame';
  let rawFrameTs = events
    .filter((e) => e.name === 'DrawFrame' && (e.tid === mainTid || e.tid === compositorTid))
    .map((e) => e.ts)
    .sort((a, b) => a - b);

  if (rawFrameTs.length < 2) {
    frameSource = 'FireAnimationFrame';
    rawFrameTs = mainX.filter((e) => e.name === 'FireAnimationFrame').map((e) => e.ts).sort((a, b) => a - b);
  }
  if (rawFrameTs.length < 2) {
    frameSource = 'BeginFrame';
    rawFrameTs = events
      .filter((e) => e.name === 'BeginFrame' && (e.tid === mainTid || e.tid === compositorTid))
      .map((e) => e.ts)
      .sort((a, b) => a - b);
  }
  // 去重同一毫秒内的重复帧标记(<1000us)
  const frameTs = [];
  for (const ts of rawFrameTs) {
    if (!frameTs.length || ts - frameTs[frameTs.length - 1] >= 1000) {
      frameTs.push(ts);
    }
  }
  const frameIntervals = [];
  let longFrames16 = 0; // >16.7ms (<60fps)
  let severeFrames33 = 0; // >33.3ms (<30fps)
  for (let i = 1; i < frameTs.length; i++) {
    const dt = frameTs[i] - frameTs[i - 1];
    frameIntervals.push(dt);
    if (dt > 16700) longFrames16++;
    if (dt > 33300) severeFrames33++;
  }
  frameIntervals.sort((a, b) => a - b);

  // 5. 提取 UpdateCounters (JS 堆内存 / DOM 节点 / 事件监听器 / GPU 显存趋势)
  const counters = {
    heap: { start: null, min: Infinity, max: -Infinity, end: null },
    nodes: { start: null, min: Infinity, max: -Infinity, end: null },
    listeners: { start: null, min: Infinity, max: -Infinity, end: null },
    gpuMem: { start: null, min: Infinity, max: -Infinity, end: null },
  };
  const updateCounterStat = (stat, val) => {
    if (typeof val !== 'number' || !Number.isFinite(val)) return;
    if (stat.start === null) stat.start = val;
    if (val < stat.min) stat.min = val;
    if (val > stat.max) stat.max = val;
    stat.end = val;
  };
  const counterEvents = events
    .filter((e) => e.name === 'UpdateCounters' && e.args?.data)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const e of counterEvents) {
    const d = e.args.data;
    updateCounterStat(counters.heap, d.jsHeapSizeUsed);
    updateCounterStat(counters.nodes, d.nodes);
    updateCounterStat(counters.listeners, d.jsEventListeners);
    updateCounterStat(counters.gpuMem, d.gpuMemoryAllocated);
  }

  // 计算指定线程去重嵌套后的真实忙碌时长(us),避免父子 X 事件叠加超过 100%
  const cleanThreadBusyCache = new Map();
  function getCleanThreadBusy(tid) {
    if (tid == null) return 0;
    if (cleanThreadBusyCache.has(tid)) return cleanThreadBusyCache.get(tid);
    const evs = events
      .filter((e) => e.ph === 'X' && e.tid === tid && typeof e.dur === 'number' && e.dur > 0)
      .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    let total = 0;
    let curEnd = -Infinity;
    for (const e of evs) {
      const start = Math.max(e.ts, curEnd);
      const end = e.ts + e.dur;
      if (end > start) {
        total += end - start;
        curEnd = end;
      }
    }
    cleanThreadBusyCache.set(tid, total);
    return total;
  }

  // ---- 输出 ----
  const busyMain = catTotals.Scripting + catTotals.Rendering + catTotals.Painting + catTotals.GC + catTotals.System;
  cleanThreadBusyCache.set(mainTid, busyMain);

  line('='.repeat(68));
  line(`Trace: ${file}`);
  line(`事件数: ${events.length}   时间跨度: ${fmtMs(spanUs)}   主线程 tid: ${mainTid} (${threadName.get(mainTid) || '?'})`);
  line('='.repeat(68));

  line('\n[主线程时间总账]');
  for (const k of ['Scripting', 'Rendering', 'Painting', 'GC', 'System']) {
    line(`  ${k.padEnd(10)} ${fmtMs(catTotals[k] || 0).padStart(10)}  ${pct(catTotals[k] || 0, spanUs)}`);
  }
  line(`  ${'(忙碌合计)'.padEnd(10)} ${fmtMs(busyMain).padStart(10)}  ${pct(busyMain, spanUs)} of 跨度`);
  if ((catTotals.Scripting || 0) / spanUs > 0.5) line('  ⚠ Scripting 占比过半 → CPU-bound,重点查 self-time 热点');

  line(`\n[Long Tasks >50ms]  共 ${longTasks.length} 个,显示前 ${top}`);
  longTasks.sort((a, b) => b.dur - a.dur);
  for (const t of longTasks.slice(0, top)) {
    line(`  ${fmtMs(t.dur).padStart(9)}  ${t.name}  @+${fmtMs(t.ts - traceMin)}`);
  }
  if (!longTasks.length) line('  (无 >50ms 顶层长任务;若仍掉帧请重点看下方 rAF 帧耗时与 GPU 管线)');

  if (hasCpuProfile) {
    const { byFn, activeUs, idleUs, sampledUs } = fullCpuAgg;
    const profThreadNote = mainProfileTid !== mainTid ? ` (来自 tid ${mainProfileTid})` : '';
    line(`\n[JS self-time 热点函数 (CPU profile${profThreadNote})]  采样活跃 ${fmtMs(activeUs)} / idle ${pct(idleUs, sampledUs)}  显示前 ${top}`);
    const hot = [...byFn.entries()].sort((a, b) => b[1] - a[1]);
    for (const [k, v] of hot.slice(0, top)) {
      const flag = activeUs > 0 && v / activeUs > 0.15 ? ' ⚠ 热点' : '';
      line(`  ${fmtMs(v).padStart(9)}  ${pct(v, activeUs).padStart(6)}  ${k}${flag}`);
    }
  } else {
    line(`\n[self-time 热点函数 (X 事件估算)]  显示前 ${top}`);
    const hot = [...selfTime.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    for (const [k, v] of hot.slice(0, top)) {
      line(`  ${fmtMs(v).padStart(9)}  ${pct(v, spanUs).padStart(6)}  ${k}`);
    }
    if (!hot.length) line('  (trace 未含函数级数据;录制时请取消勾选 Disable JavaScript samples)');
  }

  // rAF 动画帧与帧率章节(对 3D / Canvas / 动画极其关键)
  line('\n[rAF 动画帧与帧率]');
  let rafAvgUs = 0;
  let rafP95Us = 0;
  let rafOver16 = 0;
  if (rafDurs.length > 0) {
    const sortedRaf = [...rafDurs].sort((a, b) => a - b);
    const rafTotal = rafDurs.reduce((s, v) => s + v, 0);
    rafAvgUs = rafTotal / rafDurs.length;
    rafP95Us = percentile(sortedRaf, 0.95);
    const rafMaxUs = sortedRaf[sortedRaf.length - 1];
    rafOver16 = rafDurs.filter((d) => d > 16700).length;
    const rafWarn = rafP95Us > 16700 ? ' ⚠ rAF 帧耗时超 16.7ms 预算(慢性掉帧)' : '';
    line(`  FireAnimationFrame: ${rafDurs.length} 次 | 均值 ${fmtMs(rafAvgUs)} | P95 ${fmtMs(rafP95Us)} | 最大 ${fmtMs(rafMaxUs)} | >16.7ms: ${rafOver16} 次 (${pct(rafOver16, rafDurs.length)})${rafWarn}`);
  } else {
    line('  FireAnimationFrame: 0 次 (非 rAF 驱动或录制期无动画循环)');
  }

  if (frameIntervals.length > 0) {
    const avgInterval = frameIntervals.reduce((s, v) => s + v, 0) / frameIntervals.length;
    const estFps = avgInterval > 0 ? (1000000 / avgInterval).toFixed(1) : '?';
    const p95Interval = percentile(frameIntervals, 0.95);
    const maxInterval = frameIntervals[frameIntervals.length - 1];
    line(`  帧间隔 (${frameSource}, 共 ${frameIntervals.length} 帧): 估算均值 ~${estFps} FPS | P95 帧间隔 ${fmtMs(p95Interval)} | 最长帧间隔 ${fmtMs(maxInterval)}`);
    line(`  掉帧统计: >16.7ms(<60fps) ${longFrames16} 帧 (${pct(longFrames16, frameIntervals.length)}) | >33.3ms(<30fps) ${severeFrames33} 帧 (${pct(severeFrames33, frameIntervals.length)})`);
  } else {
    line('  帧间隔: (trace 未含足够的 DrawFrame / BeginFrame / rAF 事件)');
  }

  // GPU / 3D / 纹理解码信号
  const sig3d = fullCpuAgg.signals3D;
  const totalShaderUs = Math.max(shaderEventDur, sig3d.shaderCompile);
  const totalTexDecodeUs = Math.max(imageDecodeDur, sig3d.textureUploadDecode);
  const has3DOrGpuActivity =
    gpuTaskDur > 0 ||
    totalShaderUs > 0 ||
    sig3d.gpuSyncStall > 0 ||
    totalTexDecodeUs > 0 ||
    sig3d.raycast > 0 ||
    sig3d.drawSubmission > 0;

  if (has3DOrGpuActivity) {
    line('\n[GPU / 3D 渲染管线与纹理解码]');
    const gpuThreadBusy = gpuTid != null ? getCleanThreadBusy(gpuTid) : gpuTaskDur;
    line(`  GPU 任务/进程耗时: ${fmtMs(gpuThreadBusy)} (${pct(gpuThreadBusy, spanUs)} of 跨度, GPUTask ${gpuTaskCount} 次)`);
    if (sig3d.drawSubmission > 0) {
      line(`  3D 绘制提交 / 场景遍历 (drawCalls/renderBufferDirect): ${fmtMs(sig3d.drawSubmission)} (${pct(sig3d.drawSubmission, fullCpuAgg.activeUs)} of JS 活跃)`);
    }
    if (totalShaderUs > 0) {
      line(`  Shader 编译与链接 (compileShader/linkProgram): ${fmtMs(totalShaderUs)}${totalShaderUs > 16700 ? ' ⚠ 同步编译阻塞帧' : ''}`);
    }
    if (sig3d.gpuSyncStall > 0) {
      line(`  CPU-GPU 同步等待 (readPixels/getError/finish): ${fmtMs(sig3d.gpuSyncStall)} ⚠ 引发管线停顿(Pipeline Stall)`);
    }
    if (sig3d.raycast > 0) {
      line(`  3D 射线拾取 (Raycaster): ${fmtMs(sig3d.raycast)}${sig3d.raycast > 16700 ? ' ⚠ 拾取过重,建议引入 BVH 加速' : ''}`);
    }
    if (totalTexDecodeUs > 0) {
      line(`  图片/纹理解码与上传 (Decode/texImage2D): ${fmtMs(totalTexDecodeUs)} (${imageDecodeCount} 次事件)`);
    }
  }

  line('\n[DOM 渲染 / 布局]');
  line(`  Layout 次数: ${layoutCount}  总耗时: ${fmtMs(layoutDur)}`);
  line(`  Style 重算次数: ${styleCount}`);
  line(`  疑似强制同步布局(脚本内触发 Layout): ${forcedLayout} ${forcedLayout > 0 ? '⚠ layout thrashing' : ''}`);

  line('\n[GC 与内存 / DOM 趋势]');
  const totalGcUs = Math.max(gcDur, fullCpuAgg.gcSampleUs);
  line(`  GC 停顿: ${gcCount} 次事件  总耗时: ${fmtMs(totalGcUs)} (${pct(totalGcUs, spanUs)} of 跨度) ${totalGcUs / spanUs > 0.1 ? '⚠ GC 占比 >10%,查热路径对象分配' : ''}`);
  if (counters.heap.start !== null) {
    const heapDelta = counters.heap.end - counters.heap.start;
    const heapSign = heapDelta >= 0 ? '+' : '';
    const leakFlag = heapDelta > 20 * 1024 * 1024 && counters.heap.end > counters.heap.max * 0.85 ? ' ⚠ 堆内存净增显著且未回落,排查泄漏' : '';
    line(`  JS Heap: 起点 ${fmtMB(counters.heap.start)} → 峰值 ${fmtMB(counters.heap.max)} → 终点 ${fmtMB(counters.heap.end)} (净变 ${heapSign}${fmtMB(heapDelta)})${leakFlag}`);
  }
  if (counters.nodes.start !== null) {
    const nodeDelta = counters.nodes.end - counters.nodes.start;
    const nodeSign = nodeDelta >= 0 ? '+' : '';
    line(`  DOM 节点数: 起点 ${counters.nodes.start} → 峰值 ${counters.nodes.max} → 终点 ${counters.nodes.end} (${nodeSign}${nodeDelta})`);
  }
  if (counters.listeners.start !== null) {
    const lisDelta = counters.listeners.end - counters.listeners.start;
    const lisSign = lisDelta >= 0 ? '+' : '';
    line(`  事件监听器: 起点 ${counters.listeners.start} → 峰值 ${counters.listeners.max} → 终点 ${counters.listeners.end} (${lisSign}${lisDelta})`);
  }
  if (counters.gpuMem.start !== null) {
    const gpuDelta = counters.gpuMem.end - counters.gpuMem.start;
    const gpuSign = gpuDelta >= 0 ? '+' : '';
    line(`  GPU 显存: 起点 ${fmtMB(counters.gpuMem.start)} → 峰值 ${fmtMB(counters.gpuMem.max)} → 终点 ${fmtMB(counters.gpuMem.end)} (${gpuSign}${fmtMB(gpuDelta)})`);
  }

  line('\n[线程忙碌占比]');
  const busyRank = [...threadBusy.keys()]
    .map((t) => [t, getCleanThreadBusy(t)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  for (const [t, busy] of busyRank) {
    const nm = threadName.get(t) || '?';
    const mark =
      t === mainTid
        ? ' ← 主线程'
        : t === gpuTid
          ? ' (GPU 线程)'
          : /Worker|DedicatedWorker/.test(nm)
            ? ' (worker)'
            : '';
    line(`  tid ${String(t).padStart(7)}  ${pct(busy, spanUs).padStart(6)}  ${nm}${mark}`);
  }
  const workerBusy = busyRank
    .filter(([t]) => t !== mainTid && /Worker/.test(threadName.get(t) || ''))
    .reduce((s, [, b]) => s + b, 0);
  if ((catTotals.Scripting || 0) > workerBusy * 4 && workerBusy < spanUs * 0.05 && (catTotals.Scripting || 0) > spanUs * 0.3) {
    line('  ⚠ 主线程 Scripting 远超 worker → 重计算可能压在主线程,考虑 offload 到 Web Worker');
  }

  // 可选:钻某个时间窗(--window START-END,毫秒,相对 trace 起点),同时展示 X 事件与 CPU 采样热点!
  if (winStartUs != null && winEndUs != null) {
    line(`\n[时间窗 +${winStartMs}ms ~ +${winEndMs}ms 钻取明细]`);
    const inWin = events
      .filter((ev) => ev.ph === 'X' && ev.tid === mainTid && typeof ev.dur === 'number' &&
        ev.ts < winEndUs && ev.ts + ev.dur > winStartUs)
      .sort((a, b) => b.dur - a.dur)
      .slice(0, top);

    if (inWin.length) {
      line(`  -- 主线程 X 事件 Top ${Math.min(top, inWin.length)} --`);
      for (const ev of inWin) {
        const data = ev.args?.data || {};
        const label = data.functionName ? `${data.functionName}${data.url ? ' @' + shortUrl(data.url) : ''}` : ev.name;
        line(`  ${fmtMs(ev.dur).padStart(9)}  [${categoryOf(ev.name)}]  ${label}  @+${fmtMs(ev.ts - traceMin)}`);
      }
    } else {
      line('  (该时间窗主线程无 X 事件)');
    }

    if (hasCpuProfile) {
      const winCpu = aggregateProfile(mainProfile, winStartUs, winEndUs);
      const winHot = [...winCpu.byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
      if (winHot.length) {
        line(`  -- 时间窗内 JS 采样 self-time 热点 (活跃 ${fmtMs(winCpu.activeUs)}) --`);
        for (const [k, v] of winHot) {
          line(`  ${fmtMs(v).padStart(9)}  ${pct(v, winCpu.activeUs).padStart(6)}  ${k}`);
        }
      } else {
        line('  (该时间窗内无非空 JS CPU 采样)');
      }
    }
  }

  // 自动优化建议:按 trace 里实际命中的信号给出具体方向(涵盖 2D 与 3D)
  line('\n[优化建议(基于本 trace 实际信号)]');
  const recs = [];
  if (forcedLayout > 20) {
    recs.push(`强制同步布局 ${forcedLayout} 次 + Style 重算 ${styleCount} 次 → 滚动/resize/rAF 回调里读布局属性(scrollX/offsetTop/getBoundingClientRect)后又改 DOM。改法:把布局「读」批量提前、「写」放到下一帧;优先用 transform 替代 top/left。`);
  }
  const scriptRatio = (catTotals.Scripting || 0) / spanUs;
  if (scriptRatio > 0.5) {
    recs.push(`主线程 Scripting 占比 ${pct(catTotals.Scripting, spanUs)} → CPU-bound。优先优化上方 JS self-time 排第一的热点函数;纯计算/解压/编解码挪进 Web Worker,或用 scheduler.yield() 分片。`);
  }
  if (rafDurs.length >= 5 && rafP95Us > 16700) {
    recs.push(`rAF 动画帧 P95 耗时 ${fmtMs(rafP95Us)} (超 16.7ms 预算 ${rafOver16}/${rafDurs.length} 次) → 每帧渲染循环过重。若是 3D 场景:检查 DrawCall 数量(用 InstancedMesh/合批)、Raycaster 拾取(加 BVH)、是否在 useFrame/rAF 内 setState 或频繁 new Vector3/Matrix4;若是静态场景改用按需渲染(frameloop="demand")。`);
  }
  const gpuThreadBusy = gpuTid != null ? getCleanThreadBusy(gpuTid) : gpuTaskDur;
  if (
    frameIntervals.length >= 10 &&
    longFrames16 > frameIntervals.length * 0.25 &&
    busyMain / spanUs < 0.45 &&
    gpuThreadBusy / spanUs > 0.35
  ) {
    recs.push(`掉帧率 ${pct(longFrames16, frameIntervals.length)} 但主线程忙碌度仅 ${pct(busyMain, spanUs)},同时 GPU 忙碌度达 ${pct(gpuThreadBusy, spanUs)} → 疑似 GPU-bound。改法:限制渲染 DPR(Math.min(devicePixelRatio, 2))、精简片元着色器与后处理 Pass(Bloom/SSAO/SSR)、降低阴影贴图分辨率、减少半透明叠加(Overdraw)。`);
  }
  if (totalShaderUs > 16700) {
    recs.push(`Shader 编译/链接耗时 ${fmtMs(totalShaderUs)} → 新材质入屏或动态宏拼接触发同步编译卡顿(Stutter)。改法:在加载阶段调用 renderer.compileAsync() 预编译,复用 Material 实例,避免运行时动态改材质宏。`);
  }
  if (sig3d.gpuSyncStall > 5000) {
    recs.push(`检测到 CPU-GPU 同步等待(readPixels/getError/finish)耗时 ${fmtMs(sig3d.gpuSyncStall)} → 阻塞 GPU 管线并行。改法:移除渲染循环中的 getError/readPixels;必须读回像素时改用 WebGL2 异步 PBO + fenceSync 或 WebGPU mapAsync。`);
  }
  if (sig3d.raycast > 16700) {
    recs.push(`3D 射线拾取(Raycaster)累计耗时 ${fmtMs(sig3d.raycast)} → 对高模网格逐三角面遍历过慢。改法:引入 three-mesh-bvh 建立空间加速结构,或仅对低模代理包围盒(Proxy Mesh)做射线检测,并对 pointermove 加节流。`);
  }
  if (totalTexDecodeUs > 50000) {
    recs.push(`图片/纹理解码与上传耗时 ${fmtMs(totalTexDecodeUs)} → 大尺寸 PNG/JPG 主线程解码与上传阻塞帧。改法:3D 纹理优先转 KTX2/BasisU GPU 压缩格式(免解压直传显存,省 4~8 倍显存),普通大图用 createImageBitmap 在 Worker 异步解码。`);
  }
  if (longTasks.length && longTasks[0].dur > 100000) {
    const lt = longTasks[0];
    const sMs = Math.max(0, Math.floor((lt.ts - traceMin) / 1000));
    const eMs = Math.ceil((lt.ts - traceMin + lt.dur) / 1000);
    recs.push(`最长任务 ${fmtMs(lt.dur)} @+${fmtMs(lt.ts - traceMin)} 超过 100ms → 运行 --window ${sMs}-${eMs} 钻取该时间窗内的 JS 采样热点函数,拆分或延后该任务。`);
  }
  if (totalGcUs / spanUs > 0.1) {
    recs.push(`GC 占比 ${pct(totalGcUs, spanUs)} 偏高 → 热路径存在高频临时对象分配(Object Churn)。检查 rAF/scroll/pointermove 回调里是否每帧 new 数组/对象/Vector3/Matrix4,改为模块级预分配复用。`);
  }
  if (counters.heap.start !== null && counters.heap.end - counters.heap.start > 20 * 1024 * 1024 && counters.heap.end > counters.heap.max * 0.85) {
    recs.push(`JS 堆内存净增 ${fmtMB(counters.heap.end - counters.heap.start)} 且未回落 → 疑似内存泄漏。排查未解绑事件、离屏 DOM 引用;若是 3D 场景请同步核查卸载时是否调用 geometry/material/texture/renderTarget.dispose()。`);
  }
  if (frameIntervals.length && longFrames16 > frameIntervals.length * 0.1 && !recs.length) {
    recs.push(`掉帧 ${longFrames16}/${frameIntervals.length} (${pct(longFrames16, frameIntervals.length)}) → 建议用 --window 钻取掉帧密集时间段,或结合 Spector.js / renderer.info 检查单帧渲染负载。`);
  }
  if (!recs.length) {
    recs.push('未命中明显异常阈值;若特定交互仍感觉卡顿,请针对该交互瞬间录制(勾选 JS Profiler 与 GPU),或用 --window 钻取现象发生的时间窗。');
  }
  recs.forEach((r, i) => line(`  ${i + 1}. ${r}`));

  line('\n' + '='.repeat(68));
  line('提示:以上是全程聚合。先打关键路径/每帧热路径上 self-time 最高的项;改后用同一场景 trace 复测同指标。');
}

function shortUrl(u) {
  try {
    const url = new URL(u);
    return url.pathname.split('/').slice(-2).join('/') + (url.search ? '?…' : '');
  } catch {
    return u.length > 48 ? '…' + u.slice(-46) : u;
  }
}

const out = [];
function line(s) { out.push(s); }

try {
  main();
  console.log(out.join('\n'));
} catch (err) {
  console.error('分析失败:', err.message);
  process.exit(1);
}
