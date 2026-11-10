#!/usr/bin/env node
// analyze-trace.mjs — Chrome DevTools Performance trace 全程分析器(纯 Node,零依赖)
//
// 用途:把几十到几百 MB 的 trace 聚合成几十行高信号结论,绝不把原始事件塞进对话上下文。
// 覆盖:普通 2D 网页(CWV/DOM/Worker/内存) + 3D 场景(WebGL / WebGPU / Three.js / R3F / Babylon / Canvas / WASM)。
// 用法:
//   node analyze-trace.mjs <trace.json | trace.json.gz> [选项]
//   --top N                每个排行榜显示前 N 项(默认 15)
//   --tid <tid | pid:tid>  强制指定主线程(默认根据 TracingStartedInBrowser 与忙碌度自动锁定主页面 CrRendererMain)
//   --window START-END     钻取相对 trace 起点 START~END 毫秒的时间窗(同时过滤 X 事件与 CPU 采样热点)
//   --fps <60|120>         目标帧率预算基准(默认 60,即 16.7ms/帧;120Hz 为 8.3ms/帧)
//   --compare <after.json> 对比改前(主参数)与改后(compare 参数)两份 trace 的核心指标变化
//   --json                 输出结构化 JSON 结果(便于程序化比对或自动化断言)

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function parseArgs(argv) {
  const args = {
    file: null,
    top: 15,
    tid: null,
    window: null,
    fps: 60,
    compare: null,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') args.top = Math.max(1, parseInt(argv[++i], 10) || 15);
    else if (a === '--tid') args.tid = argv[++i];
    else if (a === '--window') args.window = argv[++i];
    else if (a === '--fps') args.fps = Math.max(1, parseInt(argv[++i], 10) || 60);
    else if (a === '--compare') args.compare = argv[++i];
    else if (a === '--json') args.json = true;
    else if (!a.startsWith('--')) args.file = a;
  }
  return args;
}

// 支持常规 JSON.parse,并在超大 Buffer (>512MB 超过 V8 字符串上限) 时回退到逐对象流式扫描
function parseLargeTraceBuffer(buf) {
  try {
    const json = JSON.parse(buf.toString('utf8'));
    const events = Array.isArray(json) ? json : json.traceEvents;
    if (!Array.isArray(events)) {
      throw new Error('无法识别的 trace 格式:既不是数组也没有 traceEvents');
    }
    return events;
  } catch (err) {
    if (err.code !== 'ERR_STRING_TOO_LONG' && !/Invalid string length/i.test(err.message)) {
      throw err;
    }
    // 超大文件分块扫描顶层事件对象
    const events = [];
    const decoder = new TextDecoder('utf8');
    const CHUNK = 32 * 1024 * 1024;
    let carry = '';
    let inString = false;
    let escape = false;
    let depth = 0;
    let objStart = -1;
    let arrayStarted = false;

    for (let offset = 0; offset < buf.length; offset += CHUNK) {
      const slice = buf.subarray(offset, Math.min(buf.length, offset + CHUNK));
      const text = carry + decoder.decode(slice, { stream: offset + CHUNK < buf.length });
      let lastConsumed = 0;

      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (escape) {
          escape = false;
          continue;
        }
        if (inString) {
          if (ch === 0x5c /* \ */) escape = true;
          else if (ch === 0x22 /* " */) inString = false;
          continue;
        }
        if (ch === 0x22 /* " */) {
          inString = true;
          continue;
        }
        if (!arrayStarted) {
          if (ch === 0x5b /* [ */) {
            arrayStarted = true;
            lastConsumed = i + 1;
          }
          continue;
        }
        if (ch === 0x7b /* { */) {
          if (depth === 0) objStart = i;
          depth++;
        } else if (ch === 0x7d /* } */) {
          depth--;
          if (depth === 0 && objStart >= 0) {
            const rawObj = text.slice(objStart, i + 1);
            try {
              const ev = JSON.parse(rawObj);
              if (ev && typeof ev === 'object' && ('ph' in ev || 'name' in ev)) {
                events.push(ev);
              }
            } catch {
              // 忽略非 traceEvent 的外层元数据对象
            }
            objStart = -1;
            lastConsumed = i + 1;
          }
        }
      }
      carry = objStart >= 0 ? text.slice(objStart) : text.slice(lastConsumed);
      if (objStart >= 0) objStart = 0;
    }
    if (!events.length) {
      throw new Error('超大 trace 流式解析未提取到有效事件');
    }
    return events;
  }
}

export function loadTrace(file) {
  let buf = readFileSync(file);
  if (file.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b)) {
    buf = gunzipSync(buf);
  }
  return parseLargeTraceBuffer(buf);
}

const fmtMs = (us) => (us / 1000).toFixed(1) + 'ms';
const fmtMB = (bytes) => (bytes / (1024 * 1024)).toFixed(1) + 'MB';
const pct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(1) : '0.0') + '%';

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

// Chrome trace 事件名到高层类别的精确映射
// 注意:RunTask / ThreadControllerImpl::RunTask 是消息循环外壳,归入 System,避免把非 JS 任务误算进 Scripting
export function categoryOf(name) {
  if (!name) return 'System';
  if (/(MinorGC|MajorGC|GCEvent|V8\.GC|BlinkGC|CppGC|CollectGarbage)/i.test(name)) {
    return 'GC';
  }
  if (
    /^(FunctionCall|EvaluateScript|v8\.callFunction|v8\.compile|v8\.run|V8\.Execute|V8\.RunMicrotasks|RunMicrotasks|CompileScript|CompileCode|OptimizeCode|TimerFire|EventDispatch|FireAnimationFrame|FireIdleCallback|XHRReadyStateChange|XHRLoad|RequestAnimationFrame)$/i.test(
      name
    ) ||
    /^v8\./i.test(name)
  ) {
    return 'Scripting';
  }
  if (
    /^(Layout|UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet|ScheduleStyleRecalculation|InvalidateLayout|HitTest|PrePaint|Layerize|Commit|UpdateLayer|UpdateLayerTree|Animate)$/i.test(
      name
    )
  ) {
    return 'Rendering';
  }
  if (
    /^(Paint|PaintImage|CompositeLayers|RasterTask|Rasterize|Decode Image|ImageDecodeTask|DrawLazyPixelRef|ResizeImage|UploadTexture|GPUTask|CommandBuffer)$/i.test(
      name
    )
  ) {
    return 'Painting';
  }
  if (/^(ParseHTML|ResourceSendRequest|ResourceReceiveResponse|ResourceReceivedData|ResourceFinish)$/i.test(name)) {
    return 'Loading';
  }
  return 'System';
}

// 判断是否为 JS 执行上下文事件(用于判定同步触发的强制布局 Layout Thrashing)
function isJsExecutionEvent(name) {
  return /^(FunctionCall|EvaluateScript|v8\.callFunction|V8\.Execute|RunMicrotasks|TimerFire|EventDispatch|FireAnimationFrame|FireIdleCallback|XHRReadyStateChange|XHRLoad)$/i.test(
    name || ''
  );
}

// 判断是否为跨帧/异步度量标记事件(不应放入同步调用栈或线程 CPU 忙碌度统计)
function isTimelineMarkerEvent(name) {
  return /^(EventTiming|PipelineReporter|AnimationFrame|InteractiveTime|LatencyInfo\.Flow|Graphics\.Pipeline)$/i.test(
    name || ''
  );
}

// 判断是否为录制器自身开销或浏览器内部伪帧
function isProfilerArtifact(fnName) {
  return /^(CpuProfiler::StartProfiling|V8\.HandleInterrupts|\(idle\)|\(program\)|\(root\))$/.test(fnName || '');
}

// 3D / WebGL / WebGPU 相关的函数或事件特征分类
// 优先级: shaderCompile > gpuSyncStall > textureUploadDecode > raycast > drawSubmission
export function classify3DSignal(name) {
  if (!name) return null;
  if (/(compileShader|linkProgram|ShaderCompile|ProgramLink|getProgramParameter|getShaderParameter|createShaderProgram|createRenderPipeline|createComputePipeline)/i.test(name)) {
    return 'shaderCompile';
  }
  if (
    /(readPixels|glReadPixels|glGetError|glFinish|waitSync|clientWaitSync|getBufferSubData|mapAsync)/i.test(name) ||
    (/^(getError|finish)$/.test(name))
  ) {
    return 'gpuSyncStall';
  }
  if (/(texImage2D|texSubImage2D|compressedTexImage2D|texStorage2D|Decode Image|ImageDecodeTask|createImageBitmap|uploadTexture|copyExternalImageToTexture)/i.test(name)) {
    return 'textureUploadDecode';
  }
  if (/(raycast|intersectObject|intersectObjects|intersectTriangle|bvhcast)/i.test(name)) {
    return 'raycast';
  }
  if (/(drawElements|drawArrays|drawElementsInstanced|drawArraysInstanced|renderBufferDirect|projectObject|WebGLRenderingContext|WebGL2RenderingContext|GPURenderPassEncoder)/i.test(name)) {
    return 'drawSubmission';
  }
  return null;
}

const SIGNAL_PRIORITY = ['shaderCompile', 'gpuSyncStall', 'textureUploadDecode', 'raycast', 'drawSubmission'];

function shortUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u);
    return url.pathname.split('/').slice(-2).join('/') + (url.search ? '?…' : '');
  } catch {
    return u.length > 48 ? '…' + u.slice(-46) : u;
  }
}

// 将成对的 B/E 事件合成为等效 X 事件,并过滤无效事件
function normalizeEvents(rawEvents) {
  const events = [];
  const openBE = new Map(); // "pid:tid:cat:name" -> stack of B events

  for (const e of rawEvents) {
    if (!e || typeof e !== 'object') continue;
    if (e.ph === 'B' && typeof e.ts === 'number') {
      const k = `${e.pid ?? 0}:${e.tid ?? 0}:${e.cat ?? ''}:${e.name ?? ''}`;
      let st = openBE.get(k);
      if (!st) {
        st = [];
        openBE.set(k, st);
      }
      st.push(e);
      continue;
    }
    if (e.ph === 'E' && typeof e.ts === 'number') {
      const k = `${e.pid ?? 0}:${e.tid ?? 0}:${e.cat ?? ''}:${e.name ?? ''}`;
      const st = openBE.get(k);
      if (st && st.length > 0) {
        const b = st.pop();
        const dur = Math.max(0, e.ts - b.ts);
        events.push({
          ...b,
          ph: 'X',
          dur,
          args: { ...(b.args || {}), ...(e.args || {}) },
        });
      }
      continue;
    }
    events.push(e);
  }
  return events;
}

const makeThreadKey = (pid, tid) => `${pid ?? 0}:${tid ?? 0}`;

export function analyzeTraceEvents(rawEvents, options = {}) {
  const top = options.top || 15;
  const forcedTid = options.tid ?? null;
  const windowArg = options.window ?? null;
  const targetFps = options.fps || 60;
  const frameBudgetUs = Math.round(1000000 / targetFps); // 60fps -> 16667us, 120fps -> 8333us

  const events = normalizeEvents(rawEvents);

  // 1. 单趟预分桶:扫描线程名、时间跨度、各线程 X 事件桶、页面主进程候选 pid
  const threadName = new Map(); // tk -> name
  const threadMeta = new Map(); // tk -> { pid, tid, name }
  const xByThread = new Map(); // tk -> Array<event>
  const candidatePagePids = new Set();

  let traceMin = Infinity;
  let traceMax = -Infinity;
  let gpuTk = null;
  let compositorTk = null;

  for (const e of events) {
    const pid = e.pid ?? 0;
    const tid = e.tid ?? 0;
    const tk = makeThreadKey(pid, tid);

    if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name) {
      threadName.set(tk, e.args.name);
      threadMeta.set(tk, { pid, tid, name: e.args.name });
      if (gpuTk == null && /^CrGpuMain$/i.test(e.args.name)) gpuTk = tk;
      if (compositorTk == null && /^Compositor$/i.test(e.args.name)) compositorTk = tk;
    }

    // 识别浏览器录制的真实目标页面进程 pid (排除插件进程与空白备用进程)
    if (e.name === 'TracingStartedInBrowser' && Array.isArray(e.args?.data?.frames)) {
      for (const f of e.args.data.frames) {
        if (f.processId && typeof f.url === 'string' && /^https?:\/\//i.test(f.url)) {
          candidatePagePids.add(f.processId);
        }
      }
    } else if (e.name === 'TracingStartedInPage' && pid) {
      candidatePagePids.add(pid);
    }

    if (typeof e.ts === 'number' && e.ts > 0 && e.ph !== 'M') {
      if (e.ts < traceMin) traceMin = e.ts;
      const end = e.ts + (e.dur || 0);
      if (end > traceMax) traceMax = end;
    }

    if (e.ph === 'X' && typeof e.dur === 'number' && e.dur > 0 && !isTimelineMarkerEvent(e.name)) {
      let list = xByThread.get(tk);
      if (!list) {
        list = [];
        xByThread.set(tk, list);
      }
      list.push(e);
      if (!threadMeta.has(tk)) {
        threadMeta.set(tk, { pid, tid, name: threadName.get(tk) || '?' });
      }
    }
  }

  if (!Number.isFinite(traceMin) || !Number.isFinite(traceMax)) {
    traceMin = 0;
    traceMax = 1;
  }
  const spanUs = Math.max(1, traceMax - traceMin);

  // 计算指定线程去重嵌套后的真实忙碌时长(us),复杂度 O(K log K),K 为该线程自身事件数
  const cleanThreadBusyCache = new Map();
  function getCleanThreadBusy(tk) {
    if (!tk) return 0;
    if (cleanThreadBusyCache.has(tk)) return cleanThreadBusyCache.get(tk);
    const evs = xByThread.get(tk);
    if (!evs || !evs.length) {
      cleanThreadBusyCache.set(tk, 0);
      return 0;
    }
    const sorted = [...evs].sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    let total = 0;
    let curEnd = -Infinity;
    for (const e of sorted) {
      const start = Math.max(e.ts, curEnd);
      const end = e.ts + e.dur;
      if (end > start) {
        total += end - start;
        curEnd = end;
      }
    }
    cleanThreadBusyCache.set(tk, total);
    return total;
  }

  // 选主线程:
  // 1) 若指定 --tid (支持 "tid" 或 "pid:tid"),精确匹配
  // 2) 在所有 CrRendererMain 中,优先选属于 candidatePagePids 且真实忙碌时间最长的线程
  // 3) 若无 CrRendererMain,选真实忙碌时间最长的线程
  let mainTk = null;
  if (forcedTid != null) {
    const s = String(forcedTid);
    if (s.includes(':')) {
      mainTk = s;
    } else {
      const targetTid = Number(s);
      const matches = [...threadMeta.entries()].filter(([, m]) => m.tid === targetTid);
      matches.sort((a, b) => getCleanThreadBusy(b[0]) - getCleanThreadBusy(a[0]));
      mainTk = matches[0]?.[0] || makeThreadKey(0, targetTid);
    }
  } else {
    const rendererThreads = [...threadMeta.entries()].filter(([, m]) => m.name === 'CrRendererMain');
    if (rendererThreads.length > 0) {
      rendererThreads.sort((a, b) => {
        const aInPage = candidatePagePids.has(a[1].pid) ? 1 : 0;
        const bInPage = candidatePagePids.has(b[1].pid) ? 1 : 0;
        if (aInPage !== bInPage) return bInPage - aInPage;
        return getCleanThreadBusy(b[0]) - getCleanThreadBusy(a[0]);
      });
      mainTk = rendererThreads[0][0];
    } else {
      const allThreads = [...xByThread.keys()].sort((a, b) => getCleanThreadBusy(b) - getCleanThreadBusy(a));
      mainTk = allThreads[0] || makeThreadKey(0, 0);
    }
  }

  const mainMeta = threadMeta.get(mainTk) || { pid: 0, tid: Number(mainTk.split(':')[1] || 0), name: '?' };
  const mainPid = mainMeta.pid;
  const mainTid = mainMeta.tid;

  // 若存在同进程的 Compositor 线程,优先绑定同进程 Compositor
  for (const [tk, m] of threadMeta) {
    if (m.name === 'Compositor' && m.pid === mainPid) {
      compositorTk = tk;
      break;
    }
  }

  // 解析 --window START-END (毫秒)
  let winStartUs = null;
  let winEndUs = null;
  let winStartMs = null;
  let winEndMs = null;
  if (windowArg) {
    const [s, e2] = String(windowArg).split('-').map(Number);
    if (Number.isFinite(s) && Number.isFinite(e2) && e2 > s) {
      winStartMs = s;
      winEndMs = e2;
      winStartUs = traceMin + s * 1000;
      winEndUs = traceMin + e2 * 1000;
    }
  }

  // 2. 解析现代 trace 的 Profile / ProfileChunk (按 pid:id 关联,再归并到线程 tk,保留完整父子调用链)
  // 修复 P0-3: Profile 的 startTime 绝不被后续 ProfileChunk 的 e.ts 覆盖!
  const profileById = new Map(); // "pid:id" -> { tk, pid, tid, nodes: Map<id, {callFrame, parent}>, cursorTs, hasExplicitStart, samples }
  const profileByTk = new Map(); // tk -> state

  const getOrCreateProfile = (pid, tid, profId, startTime, isExplicitStart) => {
    const tk = makeThreadKey(pid, tid);
    const idKey = `${pid}:${profId || tid}`;
    let st = profileById.get(idKey) || profileByTk.get(tk);
    if (!st) {
      st = {
        tk,
        pid,
        tid,
        nodes: new Map(),
        cursorTs: startTime ?? traceMin,
        hasExplicitStart: Boolean(isExplicitStart),
        samples: [],
      };
      profileById.set(idKey, st);
      profileByTk.set(tk, st);
    } else {
      if (isExplicitStart && startTime != null && !st.hasExplicitStart) {
        st.cursorTs = startTime;
        st.hasExplicitStart = true;
      }
      profileById.set(idKey, st);
      if (!profileByTk.has(tk)) profileByTk.set(tk, st);
    }
    return st;
  };

  for (const e of events) {
    if (e.name !== 'Profile' && e.name !== 'ProfileChunk') continue;
    const data = e.args?.data;
    if (!data) continue;
    const pid = e.pid ?? mainPid;
    const tid = e.tid ?? mainTid;
    const profId = e.id ?? data.id ?? tid;
    const explicitStart = typeof data.startTime === 'number' ? data.startTime : null;
    const st = getOrCreateProfile(
      pid,
      tid,
      profId,
      explicitStart ?? (e.ts > 0 ? e.ts : traceMin),
      explicitStart !== null
    );

    const cp = data.cpuProfile || data;
    if (Array.isArray(cp?.nodes)) {
      for (const n of cp.nodes) {
        const existing = st.nodes.get(n.id);
        const callFrame = n.callFrame || existing?.callFrame || {};
        const parent = n.parent !== undefined ? n.parent : (existing?.parent ?? null);
        st.nodes.set(n.id, { callFrame, parent });
        if (Array.isArray(n.children)) {
          for (const cid of n.children) {
            const childNode = st.nodes.get(cid);
            if (childNode) childNode.parent = n.id;
            else st.nodes.set(cid, { callFrame: {}, parent: n.id });
          }
        }
      }
    }

    const samples = cp?.samples;
    const deltas = data.timeDeltas || cp?.timeDeltas;
    if (Array.isArray(samples) && Array.isArray(deltas)) {
      // 仅当从未收到过 Profile.startTime 且当前无任何 sample 时,才用 chunk 自身 ts 推算起点
      if (!st.hasExplicitStart && st.samples.length === 0 && typeof e.ts === 'number' && e.ts > traceMin) {
        const chunkSum = deltas.reduce((s, d) => s + Math.max(0, d || 0), 0);
        st.cursorTs = Math.max(traceMin, e.ts - chunkSum);
        st.hasExplicitStart = true;
      }
      for (let i = 0; i < samples.length; i++) {
        const dt = Math.max(0, deltas[i] || 0);
        st.cursorTs += dt;
        st.samples.push({ ts: st.cursorTs, dt, id: samples[i] });
      }
    }
  }

  // 主线程 CPU Profile 选择(切勿把已知的 Worker 线程采样误当成主线程采样)
  const isKnownWorker = (tk) => /Worker|Worklet/i.test(threadName.get(tk) || '');
  let mainProfileTk = mainTk;
  if (!profileByTk.get(mainProfileTk)?.samples.length) {
    const samePidProfiles = [...profileByTk.entries()]
      .filter(([tk, st]) => st.pid === mainPid && st.samples.length > 0 && !isKnownWorker(tk))
      .sort((a, b) => b[1].samples.length - a[1].samples.length);
    if (samePidProfiles.length) {
      mainProfileTk = samePidProfiles[0][0];
    } else {
      const anyProfiles = [...profileByTk.entries()]
        .filter(([tk, st]) => st.samples.length > 0 && !isKnownWorker(tk))
        .sort((a, b) => b[1].samples.length - a[1].samples.length);
      if (anyProfiles.length) mainProfileTk = anyProfiles[0][0];
    }
  }
  const mainProfile = profileByTk.get(mainProfileTk);
  const hasCpuProfile = Boolean(mainProfile && mainProfile.samples.length > 0);

  // 向上回溯调用栈祖先,识别包含时间(Inclusive Time)的 3D 信号
  function find3DSignalInCallChain(nodesMap, leafId) {
    const matched = new Set();
    let curId = leafId;
    let depth = 0;
    while (curId != null && depth < 64) {
      depth++;
      const node = nodesMap.get(curId);
      if (!node) break;
      const fn = node.callFrame?.functionName || '';
      const sig = classify3DSignal(fn);
      if (sig) matched.add(sig);
      if (node.parent == null || node.parent === curId) break;
      curId = node.parent;
    }
    if (!matched.size) return null;
    for (const p of SIGNAL_PRIORITY) {
      if (matched.has(p)) return p;
    }
    return null;
  }

  // 聚合某个 profile state 的函数热点(支持时间窗过滤)
  function aggregateProfile(profState, startUs = null, endUs = null) {
    const byFn = new Map(); // key -> self us
    const signals3D = {
      shaderCompile: 0,
      gpuSyncStall: 0,
      textureUploadDecode: 0,
      raycast: 0,
      drawSubmission: 0,
    };
    let sampledUs = 0;
    let idleUs = 0;
    let gcSampleUs = 0;
    if (!profState) return { byFn, signals3D, sampledUs, idleUs, gcSampleUs, activeUs: 0 };

    for (const s of profState.samples) {
      if (startUs != null && (s.ts < startUs || s.ts > endUs)) continue;
      sampledUs += s.dt;
      const node = profState.nodes.get(s.id);
      const cf = node?.callFrame || {};
      const fn = cf.functionName || '(anonymous)';
      if (isProfilerArtifact(fn)) {
        idleUs += s.dt;
        continue;
      }
      if (fn === '(garbage collector)') {
        gcSampleUs += s.dt;
      }

      // 修复 P0-5: 沿调用栈向上查找祖先帧,确保 Raycaster / renderBufferDirect 的子函数耗时不漏记
      const sig = find3DSignalInCallChain(profState.nodes, s.id);
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

  // Worker 线程 CPU Profile 聚合(P1: 支持核查 Worker 是否真正在干活及其热点)
  const workerProfiles = [];
  for (const [tk, st] of profileByTk) {
    if (tk === mainProfileTk || !st.samples.length) continue;
    const nm = threadName.get(tk) || '';
    if (/Worker|DedicatedWorker|ServiceWorker|AudioWorklet/i.test(nm) || st.pid === mainPid) {
      const agg = aggregateProfile(st);
      if (agg.activeUs > 1000) {
        workerProfiles.push({
          tk,
          tid: st.tid,
          name: nm || `Thread-${st.tid}`,
          activeUs: agg.activeUs,
          topHotspots: [...agg.byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
        });
      }
    }
  }
  workerProfiles.sort((a, b) => b.activeUs - a.activeUs);

  // 3. 主线程 X 事件细粒度统计
  const catTotals = { Scripting: 0, Rendering: 0, Painting: 0, GC: 0, Loading: 0, System: 0 };
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
  let hasExplicit3DEvent = false;

  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    const tk = makeThreadKey(e.pid ?? 0, e.tid ?? 0);
    if (/^(GPUTask|CommandBuffer)$/i.test(e.name) || (gpuTk != null && tk === gpuTk)) {
      if (tk === gpuTk || e.name === 'GPUTask') {
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
      hasExplicit3DEvent = true;
    }
    if (/(WebGL|WebGPU|Three|Babylon|OffscreenCanvas)/i.test(e.name) || /(webgl|webgpu)/i.test(e.cat || '')) {
      hasExplicit3DEvent = true;
    }
  }

  const mainX = [...(xByThread.get(mainTk) || [])].sort((a, b) => a.ts - b.ts || b.dur - a.dur);

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
    if (e.name === 'Layout') {
      layoutCount++;
      layoutDur += e.dur;
    }
    if (/^(RecalculateStyles|UpdateLayoutTree|ScheduleStyleRecalculation)$/.test(e.name)) {
      styleCount++;
    }
    if (categoryOf(e.name) === 'GC') {
      gcCount++;
      gcDur += e.dur;
    }
    if (e.name === 'FireAnimationFrame') {
      rafDurs.push(e.dur);
    }

    while (stack.length && (stack[stack.length - 1].end <= e.ts || e.ts + e.dur > stack[stack.length - 1].end + 10)) {
      settle(stack.pop());
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.childDur += e.dur;
    else if (e.dur > 50000) {
      const fn = e.args?.data?.functionName || '';
      if (!isProfilerArtifact(fn) && !isProfilerArtifact(e.name)) {
        longTasks.push({ name: e.name, dur: e.dur, ts: e.ts });
      }
    }

    // 修复 P0-1: 强制同步布局判定
    // 条件 A: Chrome 在 Layout.args.beginData.stackTrace 或 args.data.stackTrace 记录了触发栈
    // 条件 B: 调用栈祖先中存在真正的 JS 执行事件(FunctionCall / FireAnimationFrame / EventDispatch / TimerFire 等),而非普通 RunTask
    if (e.name === 'Layout') {
      const hasStackTrace =
        (Array.isArray(e.args?.beginData?.stackTrace) && e.args.beginData.stackTrace.length > 0) ||
        (Array.isArray(e.args?.data?.stackTrace) && e.args.data.stackTrace.length > 0);
      const insideJsExecution = stack.some((anc) => isJsExecutionEvent(anc.name));
      if (hasStackTrace || insideJsExecution) {
        forcedLayout++;
      }
    }

    stack.push({ name: e.name, end: e.ts + e.dur, childDur: 0, dur: e.dur, ev: e });
  }
  while (stack.length) settle(stack.pop());

  // 4. 帧率与掉帧统计(修复 P0-9: 区分真实掉帧与静态页面空闲休眠,支持 PipelineReporter 与高刷屏预算)
  let pipelinePresented = 0;
  let pipelineDropped = 0;
  for (const e of events) {
    if (e.name === 'PipelineReporter' && e.args?.chrome_frame_reporter) {
      const st = e.args.chrome_frame_reporter.state;
      if (st === 'STATE_DROPPED') pipelineDropped++;
      else if (st === 'STATE_PRESENTED_ALL' || st === 'STATE_PRESENTED_PARTIAL') pipelinePresented++;
    }
  }

  let frameSource = 'DrawFrame';
  let rawFrameTs = events
    .filter((e) => {
      if (e.name !== 'DrawFrame') return false;
      const tk = makeThreadKey(e.pid ?? 0, e.tid ?? 0);
      return tk === mainTk || tk === compositorTk || (e.pid ?? 0) === mainPid;
    })
    .map((e) => e.ts)
    .sort((a, b) => a - b);

  if (rawFrameTs.length < 2) {
    frameSource = 'FireAnimationFrame';
    rawFrameTs = mainX
      .filter((e) => e.name === 'FireAnimationFrame')
      .map((e) => e.ts)
      .sort((a, b) => a - b);
  }
  if (rawFrameTs.length < 2) {
    frameSource = 'BeginFrame';
    rawFrameTs = events
      .filter((e) => {
        if (e.name !== 'BeginFrame') return false;
        const tk = makeThreadKey(e.pid ?? 0, e.tid ?? 0);
        return tk === mainTk || tk === compositorTk || (e.pid ?? 0) === mainPid;
      })
      .map((e) => e.ts)
      .sort((a, b) => a - b);
  }

  // 去重同一 vsync 周期内的多次回调(<4ms = 4000us)
  const frameTs = [];
  for (const ts of rawFrameTs) {
    if (!frameTs.length || ts - frameTs[frameTs.length - 1] >= 4000) {
      frameTs.push(ts);
    }
  }

  const IDLE_GAP_THRESHOLD_US = 250000; // >250ms 且期间无长任务阻塞,视为页面静止/按需渲染休眠
  const frameIntervals = [];
  let idleGapCount = 0;
  let longFramesBudget = 0; // > frameBudgetUs (如 16.7ms @60Hz 或 8.3ms @120Hz)
  let severeFrames2x = 0; // > 2 * frameBudgetUs (如 33.3ms @60Hz)

  for (let i = 1; i < frameTs.length; i++) {
    const prevTs = frameTs[i - 1];
    const curTs = frameTs[i];
    const dt = curTs - prevTs;
    if (dt > IDLE_GAP_THRESHOLD_US) {
      const blockedByLongTask = longTasks.some((lt) => lt.ts < curTs && lt.ts + lt.dur > prevTs);
      if (!blockedByLongTask) {
        idleGapCount++;
        continue;
      }
    }
    frameIntervals.push(dt);
    if (dt > frameBudgetUs) longFramesBudget++;
    if (dt > frameBudgetUs * 2) severeFrames2x++;
  }
  frameIntervals.sort((a, b) => a - b);

  // 5. 提取 UpdateCounters (修复 P0-4 & P0-8: 过滤 mainPid,同时兼容 gpuMemoryUsedKB 与 gpuMemoryAllocated)
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

  let counterEvents = events.filter(
    (e) => e.name === 'UpdateCounters' && e.args?.data && (mainPid === 0 || (e.pid ?? 0) === mainPid)
  );
  if (!counterEvents.length) {
    counterEvents = events.filter((e) => e.name === 'UpdateCounters' && e.args?.data);
  }
  counterEvents.sort((a, b) => (a.ts || 0) - (b.ts || 0));

  for (const e of counterEvents) {
    const d = e.args.data;
    updateCounterStat(counters.heap, d.jsHeapSizeUsed);
    updateCounterStat(counters.nodes, d.nodes);
    updateCounterStat(counters.listeners, d.jsEventListeners);
    const gpuBytes =
      typeof d.gpuMemoryUsedKB === 'number'
        ? d.gpuMemoryUsedKB * 1024
        : typeof d.gpuMemoryAllocated === 'number'
          ? d.gpuMemoryAllocated
          : undefined;
    updateCounterStat(counters.gpuMem, gpuBytes);
  }

  // 6. 提取 Web Vitals (LCP / CLS / INP) 与慢资源加载信号 (P1)
  let lcpCandidate = null; // { ts, size, type }
  let clsScore = 0;
  let clsCount = 0;
  const interactions = []; // { dur, type, ts }
  const reqStartById = new Map();
  const slowResources = []; // { url, dur, mimeType }

  for (const e of events) {
    if (mainPid !== 0 && e.pid && e.pid !== mainPid) continue;
    if (e.name === 'largestContentfulPaint::Candidate' && e.args?.data) {
      const sz = e.args.data.size || 0;
      if (!lcpCandidate || sz >= lcpCandidate.size || e.ts >= lcpCandidate.ts) {
        lcpCandidate = {
          ts: e.ts,
          size: sz,
          type: e.args.data.type || '',
        };
      }
    } else if (e.name === 'LayoutShift' && e.args?.data) {
      if (!e.args.data.had_recent_input && typeof e.args.data.score === 'number') {
        clsScore += e.args.data.score;
        clsCount++;
      }
    } else if (e.name === 'EventTiming' && typeof e.dur === 'number' && e.dur > 16000) {
      interactions.push({
        dur: e.dur,
        type: e.args?.data?.type || e.args?.type || 'interaction',
        ts: e.ts,
      });
    } else if (e.name === 'EventDispatch' && typeof e.dur === 'number' && e.dur > 50000) {
      interactions.push({
        dur: e.dur,
        type: e.args?.data?.type || 'EventDispatch',
        ts: e.ts,
      });
    } else if (e.name === 'ResourceSendRequest' && e.args?.data?.requestId) {
      reqStartById.set(e.args.data.requestId, {
        ts: e.ts,
        url: e.args.data.url || '',
      });
    } else if (e.name === 'ResourceFinish' && e.args?.data?.requestId) {
      const req = reqStartById.get(e.args.data.requestId);
      if (req && e.ts > req.ts) {
        const dur = e.ts - req.ts;
        if (dur > 100000 || /\.(glb|gltf|ktx2|basis|hdr|wasm|draco)/i.test(req.url)) {
          slowResources.push({
            url: req.url,
            dur,
            decodedBodyLength: e.args.data.decodedBodyLength || 0,
          });
        }
      }
    }
  }
  interactions.sort((a, b) => b.dur - a.dur);
  slowResources.sort((a, b) => b.dur - a.dur);

  // 7. 汇总指标与章节判定
  const busyMain =
    catTotals.Scripting +
    catTotals.Rendering +
    catTotals.Painting +
    catTotals.GC +
    catTotals.Loading;
  // 主线程真实非重叠忙碌时长(包含 System 外壳)
  const mainCleanBusy = getCleanThreadBusy(mainTk);
  catTotals.System = Math.max(0, mainCleanBusy - busyMain);

  let rafAvgUs = 0;
  let rafP95Us = 0;
  let rafMaxUs = 0;
  let rafOverBudget = 0;
  if (rafDurs.length > 0) {
    const sortedRaf = [...rafDurs].sort((a, b) => a - b);
    rafAvgUs = rafDurs.reduce((s, v) => s + v, 0) / rafDurs.length;
    rafP95Us = percentile(sortedRaf, 0.95);
    rafMaxUs = sortedRaf[sortedRaf.length - 1];
    rafOverBudget = rafDurs.filter((d) => d > frameBudgetUs).length;
  }

  let estFps = null;
  let p95Interval = 0;
  let maxInterval = 0;
  if (frameIntervals.length > 0) {
    const avgInterval = frameIntervals.reduce((s, v) => s + v, 0) / frameIntervals.length;
    estFps = avgInterval > 0 ? Number((1000000 / avgInterval).toFixed(1)) : null;
    p95Interval = percentile(frameIntervals, 0.95);
    maxInterval = frameIntervals[frameIntervals.length - 1];
  }

  const sig3d = fullCpuAgg.signals3D;
  const totalShaderUs = Math.max(shaderEventDur, sig3d.shaderCompile);
  const totalTexDecodeUs = Math.max(imageDecodeDur, sig3d.textureUploadDecode);
  const gpuThreadBusy = gpuTk != null ? getCleanThreadBusy(gpuTk) : gpuTaskDur;
  const totalGcUs = Math.max(gcDur, fullCpuAgg.gcSampleUs);

  // 修复 P0-6: 区分明确的 3D 渲染管线信号 vs 普通 2D 合成/解码
  const hasExplicit3DSignals =
    hasExplicit3DEvent ||
    totalShaderUs > 0 ||
    sig3d.gpuSyncStall > 0 ||
    sig3d.raycast > 0 ||
    sig3d.drawSubmission > 0;
  const hasHeavyGpuOrDecode =
    hasExplicit3DSignals ||
    gpuThreadBusy / spanUs > 0.15 ||
    totalTexDecodeUs > 10000 ||
    counters.gpuMem.max > 0;

  return {
    eventsCount: events.length,
    spanUs,
    traceMin,
    traceMax,
    targetFps,
    frameBudgetUs,
    mainTk,
    mainPid,
    mainTid,
    mainThreadName: threadName.get(mainTk) || '?',
    gpuTk,
    catTotals,
    busyMain: mainCleanBusy,
    longTasks: longTasks.sort((a, b) => b.dur - a.dur),
    hasCpuProfile,
    mainProfileTk,
    mainProfileTid: mainProfile?.tid ?? mainTid,
    fullCpuAgg,
    selfTime,
    workerProfiles,
    rafStats: {
      count: rafDurs.length,
      avgUs: rafAvgUs,
      p95Us: rafP95Us,
      maxUs: rafMaxUs,
      overBudget: rafOverBudget,
    },
    frameStats: {
      source: frameSource,
      count: frameIntervals.length,
      idleGapCount,
      estFps,
      p95Interval,
      maxInterval,
      longFramesBudget,
      severeFrames2x,
      pipelinePresented,
      pipelineDropped,
    },
    gpu3D: {
      hasExplicit3DSignals,
      hasHeavyGpuOrDecode,
      gpuThreadBusy,
      gpuTaskCount,
      drawSubmissionUs: sig3d.drawSubmission,
      totalShaderUs,
      gpuSyncStallUs: sig3d.gpuSyncStall,
      raycastUs: sig3d.raycast,
      totalTexDecodeUs,
      imageDecodeCount,
    },
    domStats: {
      layoutCount,
      layoutDur,
      styleCount,
      forcedLayout,
    },
    gcStats: {
      gcCount,
      totalGcUs,
    },
    counters,
    webVitals: {
      lcpCandidate,
      clsScore,
      clsCount,
      worstInteraction: interactions[0] || null,
      slowResources: slowResources.slice(0, 5),
    },
    threads: [...xByThread.keys()]
      .map((tk) => ({
        tk,
        pid: threadMeta.get(tk)?.pid ?? 0,
        tid: threadMeta.get(tk)?.tid ?? 0,
        name: threadName.get(tk) || '?',
        busyUs: getCleanThreadBusy(tk),
      }))
      .sort((a, b) => b.busyUs - a.busyUs),
    windowDrill:
      winStartUs != null && winEndUs != null
        ? {
            winStartMs,
            winEndMs,
            xEvents: mainX
              .filter((ev) => ev.ts < winEndUs && ev.ts + ev.dur > winStartUs)
              .sort((a, b) => b.dur - a.dur)
              .slice(0, top),
            cpuAgg: hasCpuProfile ? aggregateProfile(mainProfile, winStartUs, winEndUs) : null,
          }
        : null,
  };
}

export function formatReport(res, file, top = 15) {
  const out = [];
  const line = (s) => out.push(s);
  const {
    spanUs,
    traceMin,
    targetFps,
    frameBudgetUs,
    mainPid,
    mainTid,
    mainThreadName,
    catTotals,
    busyMain,
    longTasks,
    hasCpuProfile,
    mainProfileTid,
    fullCpuAgg,
    selfTime,
    workerProfiles,
    rafStats,
    frameStats,
    gpu3D,
    domStats,
    gcStats,
    counters,
    webVitals,
    threads,
    windowDrill,
  } = res;
  const budgetMsLabel = (frameBudgetUs / 1000).toFixed(1) + 'ms';

  line('='.repeat(70));
  line(`Trace: ${file}`);
  line(
    `事件数: ${res.eventsCount}   时间跨度: ${fmtMs(spanUs)}   主线程: pid=${mainPid} tid=${mainTid} (${mainThreadName})`
  );
  line('='.repeat(70));

  line('\n[主线程时间总账]');
  for (const k of ['Scripting', 'Rendering', 'Painting', 'GC', 'Loading', 'System']) {
    if (k === 'Loading' && !catTotals.Loading) continue;
    line(`  ${k.padEnd(10)} ${fmtMs(catTotals[k] || 0).padStart(10)}  ${pct(catTotals[k] || 0, spanUs)}`);
  }
  line(`  ${'(忙碌合计)'.padEnd(10)} ${fmtMs(busyMain).padStart(10)}  ${pct(busyMain, spanUs)} of 跨度`);
  if ((catTotals.Scripting || 0) / spanUs > 0.5) {
    line('  ⚠ Scripting 占比过半 → 主线程 CPU-bound,重点查下方 JS self-time 热点');
  }

  // Web Vitals 与加载信号 (存在时输出)
  const hasVitals =
    webVitals.lcpCandidate ||
    webVitals.clsCount > 0 ||
    webVitals.worstInteraction ||
    webVitals.slowResources.length > 0;
  if (hasVitals) {
    line('\n[Web Vitals 与加载/交互信号]');
    if (webVitals.lcpCandidate) {
      const lcpMs = webVitals.lcpCandidate.ts - traceMin;
      const lcpWarn = lcpMs > 2500000 ? ' ⚠ LCP >2.5s' : '';
      line(`  LCP 候选: @+${fmtMs(lcpMs)} (size=${webVitals.lcpCandidate.size})${lcpWarn}`);
    }
    if (webVitals.clsCount > 0) {
      const clsWarn = webVitals.clsScore > 0.1 ? ' ⚠ CLS >0.1 布局偏移超标' : '';
      line(`  CLS 累计: ${webVitals.clsScore.toFixed(4)} (${webVitals.clsCount} 次偏移)${clsWarn}`);
    }
    if (webVitals.worstInteraction) {
      const inp = webVitals.worstInteraction;
      const inpWarn = inp.dur > 200000 ? ' ⚠ 慢交互 >200ms (INP 风险)' : '';
      line(`  最慢交互 (${inp.type}): ${fmtMs(inp.dur)} @+${fmtMs(inp.ts - traceMin)}${inpWarn}`);
    }
    if (webVitals.slowResources.length > 0) {
      for (const r of webVitals.slowResources.slice(0, 3)) {
        const sz = r.decodedBodyLength ? ` (${fmtMB(r.decodedBodyLength)})` : '';
        line(`  慢资源/3D资产: ${fmtMs(r.dur).padStart(9)}  ${shortUrl(r.url)}${sz}`);
      }
    }
  }

  line(`\n[Long Tasks >50ms]  共 ${longTasks.length} 个,显示前 ${top}`);
  for (const t of longTasks.slice(0, top)) {
    line(`  ${fmtMs(t.dur).padStart(9)}  ${t.name}  @+${fmtMs(t.ts - traceMin)}`);
  }
  if (!longTasks.length) {
    line(`  (无 >50ms 顶层长任务;若仍掉帧请重点看下方 rAF 帧耗时与 GPU 管线)`);
  }

  if (hasCpuProfile) {
    const { byFn, activeUs, idleUs, sampledUs } = fullCpuAgg;
    const profThreadNote = mainProfileTid !== mainTid ? ` (来自 tid ${mainProfileTid})` : '';
    line(
      `\n[JS self-time 热点函数 (CPU profile${profThreadNote})]  采样活跃 ${fmtMs(activeUs)} / idle ${pct(idleUs, sampledUs)}  显示前 ${top}`
    );
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

  if (workerProfiles.length > 0) {
    line('\n[Web Worker JS 热点]');
    for (const wp of workerProfiles.slice(0, 3)) {
      line(`  Worker tid=${wp.tid} (${wp.name}) 活跃 ${fmtMs(wp.activeUs)}:`);
      for (const [fnKey, us] of wp.topHotspots.slice(0, 3)) {
        line(`    ${fmtMs(us).padStart(9)}  ${pct(us, wp.activeUs).padStart(6)}  ${fnKey}`);
      }
    }
  }

  // rAF 动画帧与帧率章节
  line(`\n[rAF 动画帧与帧率 (基准 ${targetFps}Hz / ${budgetMsLabel})]`);
  if (rafStats.count > 0) {
    const rafWarn = rafStats.p95Us > frameBudgetUs ? ` ⚠ rAF 帧耗时超 ${budgetMsLabel} 预算(慢性掉帧)` : '';
    line(
      `  FireAnimationFrame: ${rafStats.count} 次 | 均值 ${fmtMs(rafStats.avgUs)} | P95 ${fmtMs(rafStats.p95Us)} | 最大 ${fmtMs(rafStats.maxUs)} | >${budgetMsLabel}: ${rafStats.overBudget} 次 (${pct(rafStats.overBudget, rafStats.count)})${rafWarn}`
    );
  } else {
    line('  FireAnimationFrame: 0 次 (非 rAF 驱动或录制期无动画循环)');
  }

  if (frameStats.count > 0) {
    const idleNote = frameStats.idleGapCount > 0 ? `, 已剔除 ${frameStats.idleGapCount} 次静止休眠间隔` : '';
    line(
      `  帧间隔 (${frameStats.source}, 共 ${frameStats.count} 活跃帧${idleNote}): 估算均值 ~${frameStats.estFps} FPS | P95 帧间隔 ${fmtMs(frameStats.p95Interval)} | 最长帧间隔 ${fmtMs(frameStats.maxInterval)}`
    );
    line(
      `  掉帧统计: >${budgetMsLabel}(<${targetFps}fps) ${frameStats.longFramesBudget} 帧 (${pct(frameStats.longFramesBudget, frameStats.count)}) | >${fmtMs(frameBudgetUs * 2)}(<${Math.round(targetFps / 2)}fps) ${frameStats.severeFrames2x} 帧 (${pct(frameStats.severeFrames2x, frameStats.count)})`
    );
  } else {
    line('  帧间隔: (trace 未含足够的连续活跃帧事件)');
  }
  if (frameStats.pipelineDropped + frameStats.pipelinePresented > 0) {
    const totalPipe = frameStats.pipelineDropped + frameStats.pipelinePresented;
    line(
      `  浏览器合成管线 (PipelineReporter): 掉帧 ${frameStats.pipelineDropped}/${totalPipe} (${pct(frameStats.pipelineDropped, totalPipe)})`
    );
  }

  // GPU / 3D / 纹理解码信号
  if (gpu3D.hasHeavyGpuOrDecode) {
    const sectionTitle = gpu3D.hasExplicit3DSignals
      ? '\n[GPU / 3D 渲染管线与纹理解码]'
      : '\n[GPU 合成与图片解码]';
    line(sectionTitle);
    line(
      `  GPU 进程主线程 (CrGpuMain 命令解码/提交): ${fmtMs(gpu3D.gpuThreadBusy)} (${pct(gpu3D.gpuThreadBusy, spanUs)} of 跨度, GPUTask ${gpu3D.gpuTaskCount} 次)`
    );
    if (gpu3D.drawSubmissionUs > 0) {
      line(
        `  3D 绘制提交 / 场景遍历 (drawCalls/renderBufferDirect 含子调用): ${fmtMs(gpu3D.drawSubmissionUs)} (${pct(gpu3D.drawSubmissionUs, fullCpuAgg.activeUs)} of JS 活跃)`
      );
    }
    if (gpu3D.totalShaderUs > 0) {
      line(
        `  Shader / Pipeline 编译链接: ${fmtMs(gpu3D.totalShaderUs)}${gpu3D.totalShaderUs > frameBudgetUs ? ' ⚠ 同步编译阻塞帧' : ''}`
      );
    }
    if (gpu3D.gpuSyncStallUs > 0) {
      line(`  CPU-GPU 同步等待 (readPixels/getError/finish): ${fmtMs(gpu3D.gpuSyncStallUs)} ⚠ 引发管线停顿(Pipeline Stall)`);
    }
    if (gpu3D.raycastUs > 0) {
      line(
        `  3D 射线拾取 (Raycaster 含子调用): ${fmtMs(gpu3D.raycastUs)}${gpu3D.raycastUs > frameBudgetUs ? ' ⚠ 拾取过重,建议引入 BVH 加速' : ''}`
      );
    }
    if (gpu3D.totalTexDecodeUs > 0) {
      line(`  图片/纹理解码与上传 (Decode/texImage2D): ${fmtMs(gpu3D.totalTexDecodeUs)} (${gpu3D.imageDecodeCount} 次事件)`);
    }
  }

  line('\n[DOM 渲染 / 布局]');
  line(`  Layout 次数: ${domStats.layoutCount}  总耗时: ${fmtMs(domStats.layoutDur)}`);
  line(`  Style 重算次数: ${domStats.styleCount}`);
  line(
    `  强制同步布局 (JS 栈内触发 Layout): ${domStats.forcedLayout} ${domStats.forcedLayout > 0 ? '⚠ layout thrashing' : ''}`
  );

  line('\n[GC 与内存 / DOM 趋势]');
  line(
    `  GC 停顿: ${gcStats.gcCount} 次事件  总耗时: ${fmtMs(gcStats.totalGcUs)} (${pct(gcStats.totalGcUs, spanUs)} of 跨度) ${gcStats.totalGcUs / spanUs > 0.1 ? '⚠ GC 占比 >10%,查热路径对象分配' : ''}`
  );
  if (counters.heap.start !== null) {
    const heapDelta = counters.heap.end - counters.heap.start;
    const heapSign = heapDelta >= 0 ? '+' : '';
    const leakFlag =
      heapDelta > 20 * 1024 * 1024 && counters.heap.end > counters.heap.max * 0.85
        ? ' ⚠ 堆内存净增显著且未回落,排查泄漏'
        : '';
    line(
      `  JS Heap: 起点 ${fmtMB(counters.heap.start)} → 峰值 ${fmtMB(counters.heap.max)} → 终点 ${fmtMB(counters.heap.end)} (净变 ${heapSign}${fmtMB(heapDelta)})${leakFlag}`
    );
  }
  if (counters.nodes.start !== null) {
    const nodeDelta = counters.nodes.end - counters.nodes.start;
    const nodeSign = nodeDelta >= 0 ? '+' : '';
    line(`  DOM 节点数: 起点 ${counters.nodes.start} → 峰值 ${counters.nodes.max} → 终点 ${counters.nodes.end} (${nodeSign}${nodeDelta})`);
  }
  if (counters.listeners.start !== null) {
    const lisDelta = counters.listeners.end - counters.listeners.start;
    const lisSign = lisDelta >= 0 ? '+' : '';
    line(
      `  事件监听器: 起点 ${counters.listeners.start} → 峰值 ${counters.listeners.max} → 终点 ${counters.listeners.end} (${lisSign}${lisDelta})`
    );
  }
  if (counters.gpuMem.start !== null) {
    const gpuDelta = counters.gpuMem.end - counters.gpuMem.start;
    const gpuSign = gpuDelta >= 0 ? '+' : '';
    line(
      `  GPU 显存: 起点 ${fmtMB(counters.gpuMem.start)} → 峰值 ${fmtMB(counters.gpuMem.max)} → 终点 ${fmtMB(counters.gpuMem.end)} (${gpuSign}${fmtMB(gpuDelta)})`
    );
  }

  line('\n[线程忙碌占比 (区间去重后)]');
  const busyRank = threads.slice(0, 6);
  for (const t of busyRank) {
    const mark =
      t.tk === res.mainTk
        ? ' ← 主线程'
        : t.tk === res.gpuTk
          ? ' (GPU 进程主线程)'
          : /Worker|DedicatedWorker/i.test(t.name)
            ? ' (worker)'
            : '';
    line(`  tid ${String(t.tid).padStart(7)}  ${pct(t.busyUs, spanUs).padStart(6)}  ${t.name}${mark}`);
  }
  const workerThreads = threads.filter((t) => t.tk !== res.mainTk && /Worker/i.test(t.name));
  const workerBusy = workerThreads.reduce((s, t) => s + t.busyUs, 0);
  if (
    workerThreads.length > 0 &&
    (catTotals.Scripting || 0) > workerBusy * 4 &&
    workerBusy < spanUs * 0.05 &&
    (catTotals.Scripting || 0) > spanUs * 0.3
  ) {
    line('  ⚠ 已存在 Worker 线程但负载极低 (<5%),重计算可能仍留在主线程或回退到了主线程');
  }

  // 时间窗钻取明细
  if (windowDrill) {
    line(`\n[时间窗 +${windowDrill.winStartMs}ms ~ +${windowDrill.winEndMs}ms 钻取明细]`);
    if (windowDrill.xEvents.length) {
      line(`  -- 主线程 X 事件 Top ${Math.min(top, windowDrill.xEvents.length)} --`);
      for (const ev of windowDrill.xEvents) {
        const data = ev.args?.data || {};
        const label = data.functionName
          ? `${data.functionName}${data.url ? ' @' + shortUrl(data.url) : ''}`
          : ev.name;
        line(`  ${fmtMs(ev.dur).padStart(9)}  [${categoryOf(ev.name)}]  ${label}  @+${fmtMs(ev.ts - traceMin)}`);
      }
    } else {
      line('  (该时间窗主线程无 X 事件)');
    }

    if (windowDrill.cpuAgg) {
      const winHot = [...windowDrill.cpuAgg.byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
      if (winHot.length) {
        line(`  -- 时间窗内 JS 采样 self-time 热点 (活跃 ${fmtMs(windowDrill.cpuAgg.activeUs)}) --`);
        for (const [k, v] of winHot) {
          line(`  ${fmtMs(v).padStart(9)}  ${pct(v, windowDrill.cpuAgg.activeUs).padStart(6)}  ${k}`);
        }
      } else {
        line('  (该时间窗内无非空 JS CPU 采样)');
      }
    }
  }

  // 自动优化建议
  line('\n[优化建议(基于本 trace 实际信号)]');
  const recs = [];
  if (domStats.forcedLayout > 10) {
    recs.push(
      `强制同步布局 ${domStats.forcedLayout} 次 + Style 重算 ${domStats.styleCount} 次 → JS 回调内读布局属性(offsetTop/getBoundingClientRect)后又写 DOM。改法:读写分离(先批量读、再统一写);动画用 transform/opacity 替代 top/left/width。`
    );
  }
  const scriptRatio = (catTotals.Scripting || 0) / spanUs;
  if (scriptRatio > 0.5) {
    recs.push(
      `主线程 Scripting 占比 ${pct(catTotals.Scripting, spanUs)} → CPU-bound。优先优化上方 JS self-time 第一热点;纯计算/解压/编解码挪进 Web Worker,或用 scheduler.yield() 分片让出主线程。`
    );
  }
  if (rafStats.count >= 5 && rafStats.p95Us > frameBudgetUs) {
    recs.push(
      `rAF 动画帧 P95 耗时 ${fmtMs(rafStats.p95Us)} (超 ${budgetMsLabel} 预算 ${rafStats.overBudget}/${rafStats.count} 次) → 每帧渲染循环过重。若是 3D 场景:核查 DrawCall 数量(用 InstancedMesh/BatchedMesh)、Raycaster 拾取(加 BVH)、是否在 useFrame/rAF 内 setState 或 new Vector3/Matrix4;静止场景改按需渲染(frameloop="demand")。`
    );
  }
  if (
    frameStats.count >= 10 &&
    frameStats.longFramesBudget > frameStats.count * 0.25 &&
    busyMain / spanUs < 0.45 &&
    gpu3D.gpuThreadBusy / spanUs > 0.35
  ) {
    recs.push(
      `掉帧率 ${pct(frameStats.longFramesBudget, frameStats.count)} 但主线程忙碌度仅 ${pct(busyMain, spanUs)},同时 CrGpuMain 忙碌度达 ${pct(gpu3D.gpuThreadBusy, spanUs)} → 疑似 GPU 渲染或命令提交瓶颈(注意 CrGpuMain 为 GPU 进程命令解码线程,非硬件着色器耗时)。验证与改法:先测 setPixelRatio(1) 看帧率是否回升;限制 DPR <= 2、精简后处理 Pass(SSR/SSAO/Bloom)、压降阴影分辨率或用 stats-gl 实测 GPU 硬件帧时。`
    );
  }
  if (gpu3D.totalShaderUs > frameBudgetUs) {
    recs.push(
      `Shader / Pipeline 编译链接耗时 ${fmtMs(gpu3D.totalShaderUs)} → 新材质入屏或动态宏拼接触发同步编译卡顿(Stutter)。改法:进场前调用 renderer.compileAsync() 或 WebGPU createRenderPipelineAsync() 预编译,复用材质实例,避免运行时动态改材质宏。`
    );
  }
  if (gpu3D.gpuSyncStallUs > 5000) {
    recs.push(
      `检测到 CPU-GPU 同步等待(readPixels/getError/finish)耗时 ${fmtMs(gpu3D.gpuSyncStallUs)} → 强制刷新命令缓冲并阻塞并行管线。改法:移除渲染循环内的 getError/readPixels;必须读回像素时改用 WebGL2 异步 PBO + fenceSync 或 WebGPU mapAsync。`
    );
  }
  if (gpu3D.raycastUs > frameBudgetUs) {
    recs.push(
      `3D 射线拾取(Raycaster 含子调用)累计耗时 ${fmtMs(gpu3D.raycastUs)} → 对高模网格逐三角面遍历过慢。改法:引入 three-mesh-bvh 建立空间索引,或用低模包围盒(Proxy Mesh)代理拾取,并对 pointermove 节流。`
    );
  }
  if (gpu3D.totalTexDecodeUs > 50000) {
    recs.push(
      `图片/纹理解码与上传耗时 ${fmtMs(gpu3D.totalTexDecodeUs)} → 大尺寸 PNG/JPG 主线程解码与上传阻塞帧。改法:3D 纹理转 KTX2/BasisU GPU 压缩格式(免解压直传显存,省 4~8 倍显存),2D 大图用 createImageBitmap 在 Worker 异步解码。`
    );
  }
  if (longTasks.length && longTasks[0].dur > 100000) {
    const lt = longTasks[0];
    const sMs = Math.max(0, Math.floor((lt.ts - traceMin) / 1000));
    const eMs = Math.ceil((lt.ts - traceMin + lt.dur) / 1000);
    recs.push(
      `最长任务 ${fmtMs(lt.dur)} @+${fmtMs(lt.ts - traceMin)} 超过 100ms → 运行 --window ${sMs}-${eMs} 钻取该时间窗内的 JS 采样热点函数,拆分或延后该任务。`
    );
  }
  if (gcStats.totalGcUs / spanUs > 0.1) {
    recs.push(
      `GC 占比 ${pct(gcStats.totalGcUs, spanUs)} 偏高 → 热路径存在高频临时对象分配(Object Churn)。检查 rAF/scroll/pointermove 回调里是否每帧 new 数组/对象/Vector3/Matrix4,改为模块级预分配复用。`
    );
  }
  if (
    counters.heap.start !== null &&
    counters.heap.end - counters.heap.start > 20 * 1024 * 1024 &&
    counters.heap.end > counters.heap.max * 0.85
  ) {
    recs.push(
      `JS 堆内存净增 ${fmtMB(counters.heap.end - counters.heap.start)} 且未回落 → 疑似内存泄漏。排查未解绑监听、离屏 DOM 引用;若是 3D 场景请同步核查卸载时是否调用 geometry/material/texture/renderTarget.dispose()。`
    );
  }
  if (webVitals.clsScore > 0.1) {
    recs.push(
      `CLS 累计达 ${webVitals.clsScore.toFixed(3)} (>0.1) → 排查无宽高占位的异步图片/Canvas 容器、晚到字体或顶部动态插入内容。`
    );
  }
  if (frameStats.count && frameStats.longFramesBudget > frameStats.count * 0.1 && !recs.length) {
    recs.push(
      `掉帧 ${frameStats.longFramesBudget}/${frameStats.count} (${pct(frameStats.longFramesBudget, frameStats.count)}) → 建议用 --window 钻取掉帧密集时间段,或结合 Spector.js / renderer.info 检查单帧渲染负载。`
    );
  }
  if (!recs.length) {
    recs.push(
      '未命中明显异常阈值;若特定交互仍感觉卡顿,请针对该交互瞬间录制(勾选 JS Profiler 与 GPU),或用 --window 钻取现象发生的时间窗。'
    );
  }
  recs.forEach((r, i) => line(`  ${i + 1}. ${r}`));

  line('\n' + '='.repeat(70));
  line('提示:以上是全程聚合。先打关键路径/每帧热路径上 self-time 最高的项;改后用 --compare 复测同指标。');
  return out.join('\n');
}

export function formatCompareReport(beforeRes, afterRes, beforeFile, afterFile) {
  const out = [];
  const line = (s) => out.push(s);
  const deltaStr = (b, a, unitFn = fmtMs, lowerIsBetter = true) => {
    if (b == null || a == null) return '—';
    const diff = a - b;
    const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
    const pctDelta = b !== 0 ? ` (${diff >= 0 ? '+' : ''}${((diff / b) * 100).toFixed(1)}%)` : '';
    const tag =
      Math.abs(diff) < 1e-6
        ? ''
        : (diff < 0 && lowerIsBetter) || (diff > 0 && !lowerIsBetter)
          ? ' ✅ 改善'
          : ' ⚠ 退化';
    return `${unitFn(b)} → ${unitFn(a)} (${sign}${unitFn(Math.abs(diff))}${pctDelta})${tag}`;
  };

  line('='.repeat(74));
  line('Trace 前后对比 (Before vs After)');
  line(`  改前 (Before): ${beforeFile} (跨度 ${fmtMs(beforeRes.spanUs)})`);
  line(`  改后 (After) : ${afterFile} (跨度 ${fmtMs(afterRes.spanUs)})`);
  line('='.repeat(74));

  line('\n[核心指标对比]');
  line(`  主线程忙碌合计 : ${deltaStr(beforeRes.busyMain, afterRes.busyMain)}`);
  line(`  Scripting 耗时 : ${deltaStr(beforeRes.catTotals.Scripting, afterRes.catTotals.Scripting)}`);
  line(`  Rendering 耗时 : ${deltaStr(beforeRes.catTotals.Rendering, afterRes.catTotals.Rendering)}`);
  line(`  Painting 耗时  : ${deltaStr(beforeRes.catTotals.Painting, afterRes.catTotals.Painting)}`);
  line(`  GC 总耗时      : ${deltaStr(beforeRes.gcStats.totalGcUs, afterRes.gcStats.totalGcUs)}`);
  line(
    `  Long Tasks 数  : ${deltaStr(beforeRes.longTasks.length, afterRes.longTasks.length, (v) => `${v}个`)}`
  );
  line(
    `  最长单任务     : ${deltaStr(beforeRes.longTasks[0]?.dur || 0, afterRes.longTasks[0]?.dur || 0)}`
  );
  if (beforeRes.rafStats.count > 0 || afterRes.rafStats.count > 0) {
    line(`  rAF P95 帧耗时 : ${deltaStr(beforeRes.rafStats.p95Us, afterRes.rafStats.p95Us)}`);
  }
  if (beforeRes.frameStats.estFps != null && afterRes.frameStats.estFps != null) {
    line(
      `  估算均值 FPS   : ${deltaStr(beforeRes.frameStats.estFps, afterRes.frameStats.estFps, (v) => `${v}fps`, false)}`
    );
    line(`  P95 帧间隔     : ${deltaStr(beforeRes.frameStats.p95Interval, afterRes.frameStats.p95Interval)}`);
  }
  if (beforeRes.gpu3D.hasHeavyGpuOrDecode || afterRes.gpu3D.hasHeavyGpuOrDecode) {
    line(`  CrGpuMain 耗时 : ${deltaStr(beforeRes.gpu3D.gpuThreadBusy, afterRes.gpu3D.gpuThreadBusy)}`);
    line(`  3D 绘制提交    : ${deltaStr(beforeRes.gpu3D.drawSubmissionUs, afterRes.gpu3D.drawSubmissionUs)}`);
    line(`  Shader 编译    : ${deltaStr(beforeRes.gpu3D.totalShaderUs, afterRes.gpu3D.totalShaderUs)}`);
    line(`  Raycaster 拾取 : ${deltaStr(beforeRes.gpu3D.raycastUs, afterRes.gpu3D.raycastUs)}`);
  }
  if (beforeRes.counters.heap.max > 0 && afterRes.counters.heap.max > 0) {
    line(`  JS Heap 峰值   : ${deltaStr(beforeRes.counters.heap.max, afterRes.counters.heap.max, fmtMB)}`);
  }
  if (beforeRes.counters.gpuMem.max > 0 && afterRes.counters.gpuMem.max > 0) {
    line(`  GPU 显存峰值   : ${deltaStr(beforeRes.counters.gpuMem.max, afterRes.counters.gpuMem.max, fmtMB)}`);
  }
  line('='.repeat(74));
  return out.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error(
      '用法: node analyze-trace.mjs <trace.json|.json.gz> [--top N] [--tid id] [--window START-END] [--fps 60|120] [--compare after.json] [--json]'
    );
    process.exit(1);
  }

  const rawEvents = loadTrace(args.file);
  const res = analyzeTraceEvents(rawEvents, args);

  if (args.compare) {
    const afterEvents = loadTrace(args.compare);
    const afterRes = analyzeTraceEvents(afterEvents, args);
    if (args.json) {
      console.log(JSON.stringify({ before: res, after: afterRes }, null, 2));
    } else {
      console.log(formatCompareReport(res, afterRes, args.file, args.compare));
    }
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(formatReport(res, args.file, args.top));
  }
}

// 仅在直接作为 CLI 脚本执行时运行 main()
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('analyze-trace.mjs') || process.argv[1].endsWith('analyze-trace'));
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error('分析失败:', err.message);
    process.exit(1);
  }
}
