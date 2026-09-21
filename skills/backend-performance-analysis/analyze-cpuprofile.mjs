#!/usr/bin/env node
// analyze-cpuprofile.mjs — V8 CPU profile 全程分析器(纯 Node,零依赖)
//
// 用途:把 .cpuprofile 聚合成几十行结论,定位 CPU 热点,绝不把原始 profile 塞进对话上下文。
// 用法:
//   node analyze-cpuprofile.mjs <file.cpuprofile | .cpuprofile.gz> [--top N]
//   --top N   每个排行榜显示前 N 项(默认 20)
//
// 输入:V8 CPU profile。来源包括:
//   - node --cpu-prof(启动即采样,退出写出 *.cpuprofile)
//   - Chrome/DevTools Inspector 的 Profiler.stop 导出
//   - clinic/其它工具导出的同格式
// 结构:{ nodes:[{id, callFrame:{functionName,url,lineNumber}, hitCount, children}], samples:[id...], timeDeltas:[us...] }
//
// 输出:self-time 热点函数、按模块/文件归并的耗时占比、疑似热循环(单函数占比过高)、总采样时长。

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

function parseArgs(argv) {
  const args = { file: null, top: 20 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') args.top = Math.max(1, parseInt(argv[++i], 10) || 20);
    else if (!a.startsWith('--')) args.file = a;
  }
  return args;
}

function loadProfile(file) {
  let buf = readFileSync(file);
  if (file.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = gunzipSync(buf);
  const json = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(json.nodes) || !Array.isArray(json.samples)) {
    throw new Error('无法识别的 cpuprofile 格式:缺少 nodes / samples');
  }
  return json;
}

const fmtMs = (us) => (us / 1000).toFixed(1) + 'ms';
const pct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(1) : '0.0') + '%';

function shortUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u);
    return url.pathname.split('/').slice(-2).join('/');
  } catch {
    const parts = u.split(/[\\/]/);
    return parts.slice(-2).join('/');
  }
}

function moduleOf(u) {
  if (!u) return '(native)';
  const m = /node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/.exec(u);
  if (m) return 'node_modules/' + m[1];
  try {
    return new URL(u).pathname.split('/').slice(0, -1).slice(-1)[0] || '(root)';
  } catch {
    const parts = u.split(/[\\/]/);
    return parts.slice(-2, -1)[0] || '(root)';
  }
}

function main() {
  const { file, top } = parseArgs(process.argv);
  if (!file) {
    console.error('用法: node analyze-cpuprofile.mjs <file.cpuprofile> [--top N]');
    process.exit(1);
  }
  const prof = loadProfile(file);
  const { nodes, samples, timeDeltas } = prof;

  const nodeById = new Map();
  for (const n of nodes) nodeById.set(n.id, n);

  // 每个 sample 命中一个 node,把对应 timeDelta 归给该 node(即 self-time)。
  const selfByNode = new Map();
  let totalUs = 0;
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    const dt = (timeDeltas && timeDeltas[i]) || 0;
    totalUs += dt;
    selfByNode.set(id, (selfByNode.get(id) || 0) + dt);
  }

  // 按函数(functionName+url)聚合 self-time
  const selfByFn = new Map();
  const selfByModule = new Map();
  let idleUs = 0;
  for (const [id, us] of selfByNode) {
    const n = nodeById.get(id);
    if (!n) continue;
    const cf = n.callFrame || {};
    const name = cf.functionName || '(anonymous)';
    if (name === '(idle)' || name === '(program)') { idleUs += us; continue; }
    const url = cf.url || '';
    const key = name + (url ? '  @' + shortUrl(url) + (cf.lineNumber >= 0 ? ':' + (cf.lineNumber + 1) : '') : '');
    selfByFn.set(key, (selfByFn.get(key) || 0) + us);
    const mod = moduleOf(url);
    selfByModule.set(mod, (selfByModule.get(mod) || 0) + us);
  }

  const activeUs = totalUs - idleUs;

  line('='.repeat(64));
  line(`CPU profile: ${file}`);
  line(`采样点: ${samples.length}   总时长: ${fmtMs(totalUs)}   活跃(非 idle): ${fmtMs(activeUs)}  ${pct(activeUs, totalUs)}`);
  line('='.repeat(64));

  line(`\n[self-time 热点函数]  显示前 ${top}(占活跃时间比)`);
  const hotFn = [...selfByFn.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of hotFn.slice(0, top)) {
    const flag = v / activeUs > 0.2 ? ' ⚠ 热循环' : '';
    line(`  ${fmtMs(v).padStart(10)}  ${pct(v, activeUs).padStart(6)}  ${k}${flag}`);
  }
  if (!hotFn.length) line('  (无有效采样)');

  line(`\n[按模块 / 文件归并]  显示前 ${Math.min(top, 12)}`);
  const hotMod = [...selfByModule.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of hotMod.slice(0, 12)) {
    line(`  ${fmtMs(v).padStart(10)}  ${pct(v, activeUs).padStart(6)}  ${k}`);
  }

  line('\n[判读]');
  const topFn = hotFn[0];
  if (topFn && topFn[1] / activeUs > 0.2) {
    line(`  单函数 ${topFn[0].split('  @')[0]} 占活跃 ${pct(topFn[1], activeUs)} → 明显热点,优先优化或降调用次数`);
  } else {
    line('  无单一压倒性热点;耗时分散,看模块归并找累积大头,或确认是否 I/O-bound(CPU profile 看不到等待)');
  }
  line(`  idle 占比 ${pct(idleUs, totalUs)} —— 高 idle 说明瓶颈可能在等待(DB/网络/锁),不在 CPU`);

  line('\n' + '='.repeat(64));
  line('提示:CPU profile 只反映 CPU 占用,看不到 I/O 等待。对着 SKILL.md 分层症状表,结合 EXPLAIN/队列面板定位。');
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
