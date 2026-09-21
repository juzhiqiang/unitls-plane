#!/usr/bin/env node
// analyze-trace.mjs — Chrome DevTools Performance trace 全程分析器(纯 Node,零依赖)
//
// 用途:把几十 MB 的 trace 聚合成几十行结论,绝不把原始事件塞进对话上下文。
// 用法:
//   node analyze-trace.mjs <trace.json | trace.json.gz> [--top N] [--tid <id>]
//   --top N   每个排行榜显示前 N 项(默认 15)
//   --tid     只统计指定线程 id(默认自动挑最忙的主线程)
//
// 输入:Chrome 性能面板导出的 trace。兼容顶层数组和 { traceEvents: [...] }。
// 输出:Long Tasks 排行 / 主线程时间总账 / self-time 热点 / layout thrashing / GC / 长帧 / 线程忙碌占比。
//
// 说明:trace 是 event-trace-format,时间单位微秒(us)。这里做的是启发式聚合,
// 用于快速定位,不追求和 DevTools 面板逐微秒一致。

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function parseArgs(argv) {
  const args = { file: null, top: 15, tid: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') args.top = Math.max(1, parseInt(argv[++i], 10) || 15);
    else if (a === '--tid') args.tid = argv[++i];
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
const pct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(1) : '0.0') + '%';

// Chrome trace 里 name 到高层类别的粗分类
function categoryOf(name) {
  if (/(RunMicrotasks|FunctionCall|EvaluateScript|v8|CompileScript|ParseAuthor|MinorGC|MajorGC|GCEvent|RunTask|TimerFire|EventDispatch|XHR|RunMicro)/.test(name)) {
    if (/GC/.test(name)) return 'GC';
    return 'Scripting';
  }
  if (/(Layout|RecalculateStyles|UpdateLayoutTree|ScheduleStyleRecalculation|InvalidateLayout|HitTest)/.test(name)) return 'Rendering';
  if (/(Paint|Raster|CompositeLayers|Draw|Decode|Resize|GPUTask|Image)/.test(name)) return 'Painting';
  return 'System';
}

function main() {
  const { file, top, tid: forcedTid } = parseArgs(process.argv);
  if (!file) {
    console.error('用法: node analyze-trace.mjs <trace.json|.json.gz> [--top N] [--tid id]');
    process.exit(1);
  }

  const events = loadTrace(file);

  // 完整(X)事件:有 dur。按线程聚合忙碌时间,挑最忙线程当主线程。
  const threadBusy = new Map(); // tid -> total dur(us)
  const threadName = new Map();
  let traceMin = Infinity;
  let traceMax = -Infinity;

  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name) {
      threadName.set(e.tid, e.args.name);
    }
    if (typeof e.ts === 'number') {
      if (e.ts < traceMin) traceMin = e.ts;
      const end = e.ts + (e.dur || 0);
      if (end > traceMax) traceMax = end;
    }
    if (e.ph === 'X' && typeof e.dur === 'number') {
      threadBusy.set(e.tid, (threadBusy.get(e.tid) || 0) + e.dur);
    }
  }

  const mainTid =
    forcedTid != null
      ? Number(forcedTid)
      : [...threadBusy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const spanUs = traceMax - traceMin;

  // 只在主线程上做细粒度统计
  const catTotals = { Scripting: 0, Rendering: 0, Painting: 0, GC: 0, System: 0 };
  const selfTime = new Map(); // "url:func" -> self us
  const longTasks = []; // {name, dur, ts}
  let layoutCount = 0;
  let layoutDur = 0;
  let styleCount = 0;
  let forcedLayout = 0; // Layout 紧跟脚本(UpdateLayoutTree with beginData) 粗略计
  let gcCount = 0;
  let gcDur = 0;

  // 为估算 self-time:主线程 X 事件按 (ts) 排序,用栈算 self = dur - 子节点 dur 之和
  const mainX = events
    .filter((e) => e.ph === 'X' && e.tid === mainTid && typeof e.dur === 'number')
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);

  // 单趟栈遍历:按 self-time(dur 减去子事件 dur)归类,避免嵌套事件重复计入。
  // pop 时结算——self-time 才是「这段时间真正花在自己身上」的量,类别占比因此可加、总和 ≤ 跨度。
  const stack = [];
  const settle = (node) => {
    const self = Math.max(0, node.dur - node.childDur);
    const cat = categoryOf(node.name);
    catTotals[cat] = (catTotals[cat] || 0) + self;
    // self-time 热点:脚本类事件,或带函数名的事件
    if (cat === 'Scripting' || node.ev.args?.data?.functionName) {
      const fn = node.ev.args?.data?.functionName || node.ev.args?.data?.url || node.name;
      const url = node.ev.args?.data?.url || '';
      const key = (fn || '(anonymous)') + (url ? '  @' + shortUrl(url) : '');
      selfTime.set(key, (selfTime.get(key) || 0) + self);
    }
  };

  for (const e of mainX) {
    if (e.name === 'Layout') { layoutCount++; layoutDur += e.dur; }
    if (/RecalculateStyles|UpdateLayoutTree|ScheduleStyleRecalculation/.test(e.name)) styleCount++;
    if (/MajorGC|MinorGC|GCEvent/.test(e.name)) { gcCount++; gcDur += e.dur; }

    while (stack.length && stack[stack.length - 1].end <= e.ts) settle(stack.pop());
    const parent = stack[stack.length - 1];
    if (parent) parent.childDur += e.dur;
    else if (e.dur > 50000) longTasks.push({ name: e.name, dur: e.dur, ts: e.ts });

    // 强制同步布局粗判:Layout 的父是脚本类
    if (e.name === 'Layout' && parent && categoryOf(parent.name) === 'Scripting') {
      forcedLayout++;
    }

    stack.push({ name: e.name, end: e.ts + e.dur, childDur: 0, dur: e.dur, ev: e });
  }
  while (stack.length) settle(stack.pop());

  // 长帧:DrawFrame / 相邻 frame 边界
  const frames = events
    .filter((e) => e.name === 'DrawFrame' || e.name === 'BeginFrame')
    .map((e) => e.ts)
    .sort((a, b) => a - b);
  let longFrames = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i] - frames[i - 1] > 16700) longFrames++;
  }

  // ---- 输出 ----
  const busyMain = catTotals.Scripting + catTotals.Rendering + catTotals.Painting + catTotals.GC + catTotals.System;

  line('='.repeat(64));
  line(`Trace: ${file}`);
  line(`事件数: ${events.length}   时间跨度: ${fmtMs(spanUs)}   主线程 tid: ${mainTid} (${threadName.get(mainTid) || '?'})`);
  line('='.repeat(64));

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
  if (!longTasks.length) line('  (无 >50ms 顶层任务)');

  line(`\n[self-time 热点函数]  显示前 ${top}`);
  const hot = [...selfTime.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of hot.slice(0, top)) {
    line(`  ${fmtMs(v).padStart(9)}  ${pct(v, spanUs).padStart(6)}  ${k}`);
  }
  if (!hot.length) line('  (trace 未含函数级数据;录制时勾选 "Enable advanced paint instrumentation" 或用 JS Profiler)');

  line('\n[渲染 / 布局]');
  line(`  Layout 次数: ${layoutCount}  总耗时: ${fmtMs(layoutDur)}`);
  line(`  Style 重算次数: ${styleCount}`);
  line(`  疑似强制同步布局(脚本内触发 Layout): ${forcedLayout} ${forcedLayout > 0 ? '⚠ layout thrashing' : ''}`);

  line('\n[GC]');
  line(`  次数: ${gcCount}  总停顿: ${fmtMs(gcDur)}  ${gcDur / spanUs > 0.1 ? '⚠ GC 占比 >10%,查对象churn/内存压力' : ''}`);

  line('\n[长帧 >16.7ms]');
  line(`  ${longFrames} 帧 ${frames.length ? `/ 共 ${frames.length} 帧` : '(trace 未含 frame 事件)'}`);

  line('\n[线程忙碌占比]');
  const busyRank = [...threadBusy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [t, busy] of busyRank) {
    const nm = threadName.get(t) || '?';
    const mark = t === mainTid ? ' ← 主线程' : /Worker|DedicatedWorker/.test(nm) ? ' (worker)' : '';
    line(`  tid ${String(t).padStart(7)}  ${pct(busy, spanUs).padStart(6)}  ${nm}${mark}`);
  }
  const workerBusy = busyRank.filter(([t, ]) => t !== mainTid && /Worker/.test(threadName.get(t) || '')).reduce((s, [, b]) => s + b, 0);
  if ((catTotals.Scripting || 0) > workerBusy * 4 && workerBusy < spanUs * 0.05) {
    line('  ⚠ 主线程 Scripting 远超 worker → 重活可能压在主线程,考虑 offload 到 Web Worker');
  }

  line('\n' + '='.repeat(64));
  line('提示:以上是全程聚合。对着 SKILL.md 的分层症状表定位,先打 self-time 最高且在关键路径上的项。');
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
