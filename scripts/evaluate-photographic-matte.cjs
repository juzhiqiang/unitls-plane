// scripts/evaluate-photographic-matte.cjs
// 对同一张样张分别跑 MODNet photographic 与 RMBG-1.4，输出量化对比。
// 用法: node scripts/evaluate-photographic-matte.cjs <样张.jpg>
//
// 依赖(与 apps/api 同一套，bun 的 node_modules 是扁平的，需从 apps/api 解析):
//   node scripts/evaluate-photographic-matte.cjs <sample.jpg> [--all] [--dump <dir>]
//   --all   同时跑 RMBG-1.4 fp32 / fp16 与通用 MODNet(256 fill)做对照
//   --dump  把各模型的 alpha 掩码导出为 PNG(便于肉眼看「衣服是否破洞」)
//
// 说明:
// - MODNet(photographic/通用)输入归一化 (x/255-0.5)/0.5，即 mean=std=0.5。
//   brief 骨架里的 `background: '#000000'` 在 sharp 中会把 pad 区填成不透明黑色，
//   故这里显式合成到黑底再 resize。
// - 默认 photographic 用 512x512 "contain"(等比缩放 + 黑边)。这是 brief 指定的口径。
//   `--refpipe` 改用参考实现 id_photo_bg_changer 的预处理:长边缩到 512、保持长宽比、
//   宽高向下取 32 的倍数、不补边(1280x1706 的样张会得到 384x512)。两种口径的差异
//   是本次实测的关键(黑边会让 photographic 在脸部/衣服上开出假洞)。
// - RMBG-1.4 输入 1024x1024，normalize mean=0.5 std=1.0(见
//   docker/models/rmbg/1.4/preprocessor_config.json)。输出已过 sigmoid(0..1)；
//   与 transformers.js background-removal pipeline 一致:若值域越界才做 sigmoid，
//   再 ×255，不做 min-max 拉伸。
// - 通用 MODNet(apps/api/models/modnet.onnx)项目内按 256x256 fill(拉伸)跑。
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const API_DIR = path.resolve(__dirname, '../apps/api');
const apiRequire = createRequire(path.join(API_DIR, 'package.json'));
const ort = apiRequire('onnxruntime-node');
const sharp = apiRequire('sharp');

const MODNET_INPUT = 512;
const MODNET_GENERIC_INPUT = 256;
const RMBG_INPUT = 1024;

const MODEL_PATHS = {
  photographic: path.resolve(__dirname, '../docker/models/modnet/modnet_photographic.onnx'),
  'modnet-generic': path.resolve(__dirname, '../apps/api/models/modnet.onnx'),
  'rmbg-fp32': path.resolve(__dirname, '../docker/models/rmbg/1.4/onnx/model.onnx'),
  'rmbg-fp16': path.resolve(__dirname, '../docker/models/rmbg/1.4/onnx/model_fp16.onnx'),
};

async function loadRgb(inputPath, size, fit) {
  // fit: 'contain' → 等比缩放 + 黑底填充;'fill' → 直接拉伸
  const { data, info } = await sharp(inputPath)
    .flatten({ background: '#000000' })
    .resize(size, size, { fit, position: 'center', background: '#000000' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

function toCHWTensor(data, size, mean, std) {
  const tensor = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      tensor[c * plane + i] = ((data[i * 3 + c] ?? 0) / 255 - mean) / std;
    }
  }
  return new ort.Tensor('float32', tensor, [1, 3, size, size]);
}

const sessions = new Map();
async function getSession(modelPath) {
  if (!sessions.has(modelPath)) {
    sessions.set(modelPath, await ort.InferenceSession.create(modelPath));
  }
  return sessions.get(modelPath);
}

async function runModel(modelPath, sample, size, fit, opts = {}) {
  const session = await getSession(modelPath);
  const { data } = await loadRgb(sample, size, fit);
  const input = toCHWTensor(data, size, opts.mean ?? 0.5, opts.std ?? 0.5);
  const feeds = { [session.inputNames[0]]: input };
  const out = await session.run(feeds);

  const outName = session.outputNames[0];
  let alpha = out[outName].data;
  // transformers.js 的做法:输出已归一化到 0..1 就原样用，否则视为 logits 做 sigmoid。
  if (opts.normalize) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of alpha) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min < -1e-5 || max > 1 + 1e-5) {
      const sig = new Float32Array(alpha.length);
      for (let i = 0; i < alpha.length; i += 1) sig[i] = 1 / (1 + Math.exp(-alpha[i]));
      alpha = sig;
    }
  }
  return { alpha, width: size, height: size };
}

/**
 * 参考实现 id_photo_bg_changer 的 photographic 预处理:长边 512、保持长宽比、
 * 宽高向下取 32 的倍数、不补边。与 brief 的 512 contain 只差「黑边」。
 */
async function runModnetRefPipe(modelPath, sample) {
  const meta = await sharp(sample).metadata();
  if (!meta.width || !meta.height) throw new Error('cannot read sample dimensions');
  const scale = MODNET_INPUT / Math.max(meta.width, meta.height);
  let width = Math.round(meta.width * scale);
  let height = Math.round(meta.height * scale);
  width = Math.max(32, width - (width % 32));
  height = Math.max(32, height - (height % 32));

  const session = await getSession(modelPath);
  const raw = await sharp(sample)
    .flatten({ background: '#000000' })
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const n = width * height;
  const tensor = new Float32Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      tensor[c * n + i] = ((raw[i * 3 + c] ?? 0) / 255 - 0.5) / 0.5;
    }
  }
  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, height, width]),
  });
  return { alpha: out[session.outputNames[0]].data, width, height };
}

// MODNet 输出是 1x1xHxW 的 alpha，形状与输入同尺寸
async function runModnet(modelPath, sample, size, fit) {
  return runModel(modelPath, sample, size, fit, { mean: 0.5, std: 0.5 });
}

async function runRmbg(modelPath, sample) {
  return runModel(modelPath, sample, RMBG_INPUT, 'fill', {
    mean: 0.5,
    std: 1,
    normalize: true,
  });
}

function summarize(alpha) {
  const sorted = Array.from(alpha).sort((a, b) => a - b);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const semi = Array.from(alpha).filter(v => v > 0.02 && v < 0.98).length;
  const fg = Array.from(alpha).filter(v => v > 0.5).length;
  return {
    p05: q(0.05).toFixed(3),
    p50: q(0.5).toFixed(3),
    p95: q(0.95).toFixed(3),
    semiRatio: ((semi / alpha.length) * 100).toFixed(2) + '%',
    fgRatio: ((fg / alpha.length) * 100).toFixed(2) + '%',
  };
}

// 找出前景掩码内部的「洞」:被前景包围、但 alpha 接近 0 的连通区域。
// 做法:从前景二值图(mask>0.5)出发做 4 邻接 flood fill 标记所有「背景连通到边界」的像素,
// 剩余的背景像素即被前景包围的洞。返回洞的像素数和最大单洞面积(占整图比例),
// 并按洞的垂直位置标注所属身体区域(top/mid/bottom),便于区分「脸部/帽子洞」与「衣服洞」。
function findHoles(alpha, width, height) {
  const n = width * height;
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) fg[i] = alpha[i] > 0.5 ? 1 : 0;

  const reachable = new Uint8Array(n); // 从边界可达的背景
  const stack = [];
  const push = idx => {
    if (!reachable[idx] && !fg[idx]) {
      reachable[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) push(idx - 1);
    if (x < width - 1) push(idx + 1);
    if (y > 0) push(idx - width);
    if (y < height - 1) push(idx + width);
  }

  // 洞 = 前景分量内部的背景:既不是前景,也不可从边界到达
  const holes = new Uint8Array(n);
  let holePixels = 0;
  for (let i = 0; i < n; i += 1) {
    if (!fg[i] && !reachable[i]) {
      holes[i] = 1;
      holePixels += 1;
    }
  }

  // 统计每个连通洞的像素数与包围盒
  const components = [];
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (!holes[i] || seen[i]) continue;
    let area = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    const st = [i];
    seen[i] = 1;
    while (st.length) {
      const idx = st.pop();
      area += 1;
      const x = idx % width;
      const y = (idx - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);
      for (const nb of neighbors) {
        if (holes[nb] && !seen[nb]) {
          seen[nb] = 1;
          st.push(nb);
        }
      }
    }
    const centerY = (minY + maxY) / 2 / height;
    components.push({
      area,
      bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      band: centerY < 1 / 3 ? 'top' : centerY < 2 / 3 ? 'mid' : 'bottom',
    });
  }
  components.sort((a, b) => b.area - a.area);

  let fgPixels = 0;
  for (let i = 0; i < n; i += 1) fgPixels += fg[i];

  const total = n;
  return {
    holePixels,
    holeRatioOfImage: (holePixels / total) * 100,
    holeRatioOfForeground: fgPixels ? (holePixels / fgPixels) * 100 : 0,
    maxHolePixels: components[0]?.area ?? 0,
    maxHoleRatioOfImage: ((components[0]?.area ?? 0) / total) * 100,
    components: components.slice(0, 10),
    fgPixels,
    fgRatio: (fgPixels / total) * 100,
  };
}

// 粗分区域统计:把图垂直切 3 段(上 1/3 / 中 1/3 / 下 1/3),
// 在每段取 alpha 的中位数与前景占比。下 1/3 近似衣服区,上 1/3 近似头部/帽子区。
function verticalBands(alpha, width, height) {
  const bands = [];
  for (let b = 0; b < 3; b += 1) {
    const y0 = Math.floor((height * b) / 3);
    const y1 = Math.floor((height * (b + 1)) / 3);
    const vals = [];
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) vals.push(alpha[y * width + x]);
    }
    vals.sort((a, b2) => a - b2);
    const med = vals[Math.floor(vals.length / 2)] ?? 0;
    const fgVals = vals.filter(v => v > 0.5);
    bands.push({
      p50: med.toFixed(3),
      fgPixels: fgVals.length,
      fgRatio: ((fgVals.length / vals.length) * 100).toFixed(2) + '%',
    });
  }
  return bands;
}

async function dumpAlpha(alpha, width, height, outPath) {
  const buf = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i += 1) {
    buf[i] = Math.max(0, Math.min(255, Math.round(alpha[i] * 255)));
  }
  await sharp(buf, { raw: { width, height, channels: 1 } }).png().toFile(outPath);
}

(async () => {
  const args = process.argv.slice(2);
  const dumpIdx = args.indexOf('--dump');
  const dumpDir = dumpIdx >= 0 ? args[dumpIdx + 1] : null;
  const runAll = args.includes('--all');
  const refPipe = args.includes('--refpipe');
  const positional = args.filter(
    (a, i) => !a.startsWith('--') && !(dumpIdx >= 0 && i === dumpIdx + 1)
  );
  const sample = positional[0];

  if (!sample) {
    console.error(
      'usage: node evaluate-photographic-matte.cjs <sample.jpg> [--all] [--refpipe] [--dump <dir>]'
    );
    process.exit(1);
  }
  if (!fs.existsSync(sample)) {
    console.error(`sample not found: ${sample}`);
    process.exit(1);
  }
  if (!fs.existsSync(MODEL_PATHS.photographic)) {
    console.error(`photographic weights not found: ${MODEL_PATHS.photographic}`);
    process.exit(1);
  }
  if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true });

  console.log(`sample: ${sample}`);
  const runs = {
    photographic: () =>
      refPipe
        ? runModnetRefPipe(MODEL_PATHS.photographic, sample)
        : runModnet(MODEL_PATHS.photographic, sample, MODNET_INPUT, 'contain'),
  };
  if (runAll) {
    runs['rmbg-fp32'] = () => runRmbg(MODEL_PATHS['rmbg-fp32'], sample);
    runs['rmbg-fp16'] = () => runRmbg(MODEL_PATHS['rmbg-fp16'], sample);
    runs['modnet-generic'] = () =>
      runModnet(MODEL_PATHS['modnet-generic'], sample, MODNET_GENERIC_INPUT, 'fill');
  }

  const report = {};
  for (const [name, fn] of Object.entries(runs)) {
    const t0 = Date.now();
    try {
      const { alpha, width, height } = await fn();
      const ms = Date.now() - t0;
      const s = summarize(alpha);
      const holes = findHoles(alpha, width, height);
      const bands = verticalBands(alpha, width, height);
      report[name] = { ms, width, height, ...s, holes, bands };
      console.log(`\n== ${name} (${width}x${height}, ${ms}ms) ==`);
      console.log(' alpha:', s);
      console.log(' holes:', {
        holePixels: holes.holePixels,
        holeRatioOfForeground: holes.holeRatioOfForeground.toFixed(2) + '%',
        maxHolePixels: holes.maxHolePixels,
        maxHoleRatioOfImage: holes.maxHoleRatioOfImage.toFixed(2) + '%',
        components: holes.components,
      });
      console.log(' bands(top/mid/bottom):', bands);
      if (dumpDir) {
        const out = path.join(dumpDir, `${name}.png`);
        await dumpAlpha(alpha, width, height, out);
        console.log(` alpha dumped: ${out}`);
      }
    } catch (err) {
      report[name] = { error: String(err && err.message ? err.message : err) };
      console.log(`\n== ${name} == FAILED: ${report[name].error}`);
    }
  }
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(report, null, 2));
})().catch(err => {
  console.error(err);
  process.exit(1);
});
