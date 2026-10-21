// 下载证件照本地抠图所需的 RMBG-1.4 模型与 onnxruntime-web wasm 运行时,
// 落到 docker/models/ 下,供 prepare 脚本同步到 MinIO `models` 桶。
//
// 目录结构与 transformers.js 的取用方式对齐(见 apps/web/src/lib/id-photo-local/model-registry.ts):
//   env.remoteHost = `${NEXT_PUBLIC_S3_PUBLIC_URL}/models/`
//   env.remotePathTemplate = '{model}/'      model = 'rmbg/1.4'
//   → 拉取 `${base}/models/rmbg/1.4/<file>`
//   env.backends.onnx.wasm.wasmPaths = `${base}/models/ort/`
//
// 产出:
//   docker/models/rmbg/1.4/config.json
//   docker/models/rmbg/1.4/preprocessor_config.json
//   docker/models/rmbg/1.4/onnx/model_fp16.onnx   (均衡档 ~88MB)
//   docker/models/rmbg/1.4/onnx/model.onnx        (高精度档 ~176MB)
//   docker/models/ort/ort-wasm-simd-threaded{,.jsep}.{wasm,mjs}
//   docker/models/modnet/modnet_photographic.onnx
//   docker/models/face/yunet/face_detection_yunet_2023mar.onnx
//
// ort 运行时直接从 node_modules 复制,而不是从 CDN 下载 —— 保证与
// @huggingface/transformers 实际依赖的 ort 版本严格一致(版本错配会导致
// wasm 与 glue 的导出对不上,例如 jsepInit/webgpuInit 之争,见 git 历史)。
//
// 许可提醒:RMBG-1.4 为 BRIA 自有许可(HF 标注 license: other),商用需向 BRIA 申请授权。
// MODNet photographic 为 Apache-2.0,YuNet 为 MIT。
//
// 用法: node scripts/download-rmbg-assets.cjs [model|runtime|modnet|yunet|all]
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION = '1.4';
const REPO = 'briaai/RMBG-1.4';
const HF = `https://huggingface.co/${REPO}/resolve/main/`;

const ROOT = path.join(__dirname, '..');
// 落到 docker/models/,与 Dockerfile `COPY docker/models/ ./models/id-photo/` 对齐
const MODEL_DIR = path.join(ROOT, 'docker', 'models', 'rmbg', VERSION);
// ort 目录带版本(见 model-registry.ORT_VERSION 注释):资产按 immutable 长缓存发布,
// 不带版本的话升级后浏览器会继续命中旧 wasm。
const ORT_ROOT = path.join(ROOT, 'docker', 'models', 'ort');
const MODNET_DIR = path.join(ROOT, 'docker', 'models', 'modnet');
const YUNET_DIR = path.join(ROOT, 'docker', 'models', 'face', 'yunet');
const REGISTRY = path.join(
  ROOT,
  'apps',
  'web',
  'src',
  'lib',
  'id-photo-local',
  'model-registry.ts'
);

// 相对 HF 仓库根的文件路径(保持同名落盘,transformers.js 按同样的相对路径取)
const MODEL_FILES = [
  'config.json',
  'preprocessor_config.json',
  'onnx/model_fp16.onnx',
  'onnx/model.onnx',
];

// transformers.js 运行 ort 所需的 wasm + glue(jsep 版供 WebGPU,普通版供 wasm 后端)
const ORT_FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
];

// MODNet photographic:Apache-2.0,参考实现仓库已内置,优先本地复制,无需联网。
// 参考仓库根目录只在显式设置 ID_PHOTO_REF_ROOT 时参与候选 —— 不把任何开发机
// 临时路径写进共享脚本默认值。未设置时只用 vendor/ 与项目内相对路径。
const REF_ROOT = process.env.ID_PHOTO_REF_ROOT || null;
const MODNET_LOCAL_CANDIDATES = [
  process.env.MODNET_LOCAL_PATH,
  path.join(ROOT, 'vendor', 'modnet_photographic.onnx'),
  REF_ROOT &&
    path.join(REF_ROOT, 'pictone', 'models', 'modnet_photographic.onnx'),
  path.join(
    ROOT,
    '..',
    'id_photo_bg_changer',
    'pictone',
    'models',
    'modnet_photographic.onnx'
  ),
].filter(Boolean);

// YuNet:OpenCV Zoo 官方发行,MIT。同样优先本地复制,离线环境可用。
// 风险:锁定到 `main` 意味着上游改名/改内容会静默改变构建输入。任务报告未提供
// 可锁定的 commit hash,故暂保持 `main`;拿到上游 commit 后应改为
// `raw/<commit>/...` 并同步更新下面的 YUNET_SHA256。
const YUNET_URL =
  'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx';
// 实测哈希(见 .git/sdd/task-7-report.md,与本地参考仓库及下载结果一致)。
const YUNET_SHA256 =
  '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4';
const YUNET_LOCAL_CANDIDATES = [
  process.env.YUNET_LOCAL_PATH,
  path.join(ROOT, 'vendor', 'face_detection_yunet_2023mar.onnx'),
  REF_ROOT &&
    path.join(
      REF_ROOT,
      'pictone',
      'models',
      'face_detection_yunet_2023mar.onnx'
    ),
].filter(Boolean);

function ortDistDir() {
  // 必须从 @huggingface/transformers 的依赖树解析,而不是从仓库根解析:
  // node_modules 里可能残留其他版本的 onnxruntime-web(历史依赖),从根解析会拿错版本,
  // 导致 wasm 与 JS glue 的导出对不上(实测:错配 1.21.0 会报
  // `_OrtGetInputOutputMetadata is not a function`)。
  //
  // transformers 的 exports 不暴露 ./package.json,故先解析主入口再向上回溯到包根。
  const tfMain = require.resolve('@huggingface/transformers', {
    paths: [path.join(ROOT, 'apps', 'web'), ROOT],
  });
  let tfRoot = path.dirname(tfMain);
  while (
    tfRoot !== path.dirname(tfRoot) &&
    !fs.existsSync(path.join(tfRoot, 'package.json'))
  ) {
    tfRoot = path.dirname(tfRoot);
  }
  const entry = require.resolve('onnxruntime-web', { paths: [tfRoot] });
  // entry 形如 .../onnxruntime-web/dist/ort.node.min.js|mjs
  let dir = path.dirname(entry);
  if (path.basename(dir) !== 'dist') dir = path.join(dir, 'dist');
  return dir;
}

/**
 * 先写 `<dest>.tmp` 再 rename 到目标名。下载/复制中断时只会残留 .tmp,
 * 不会留下一个被后续运行误认为「已完成」的半截资产。
 */
function writeFileAtomic(dest, data) {
  const tmp = `${dest}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function copyFileAtomic(src, dest) {
  const tmp = `${dest}.tmp`;
  try {
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function sha256File(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    // 幂等:已存在且非空则跳过(大文件重复下载代价高)
    console.log(`skip   ${path.relative(ROOT, dest)}`);
    return;
  }
  process.stdout.write(`fetch  ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileAtomic(dest, buf);
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)}MB`);
}

/** 读取解析到的 ort 包版本(用作资产路径前缀,并与前端常量对账)。 */
function resolvedOrtVersion(distDir) {
  // distDir 形如 .../onnxruntime-web/dist
  const pkg = path.join(path.dirname(distDir), 'package.json');
  return JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
}

/** 从 model-registry.ts 里取 ORT_VERSION 常量(单一事实来源在前端)。 */
function registryOrtVersion() {
  const src = fs.readFileSync(REGISTRY, 'utf8');
  const m = /export const ORT_VERSION = '([^']+)'/.exec(src);
  if (!m) throw new Error(`ORT_VERSION not found in ${REGISTRY}`);
  return m[1];
}

function copyOrt() {
  const dist = ortDistDir();
  const actual = resolvedOrtVersion(dist);
  const expected = registryOrtVersion();
  if (actual !== expected) {
    // 宁可构建期炸,也不要运行期错配:ort 的 JS glue 与 wasm 是配对的,
    // 版本不一致会缺导出(webgpuInit / _OrtGetInputOutputMetadata),且资产是长缓存的。
    throw new Error(
      `ort 版本不一致:解析到 ${actual},但 model-registry.ts 的 ORT_VERSION 是 ${expected}。\n` +
        `请把 ORT_VERSION 改为 ${actual}(路径带版本,改动会自动破掉旧资产的 immutable 缓存)。`
    );
  }
  const ortDir = path.join(ORT_ROOT, actual);
  fs.mkdirSync(ortDir, { recursive: true });
  for (const f of ORT_FILES) {
    const src = path.join(dist, f);
    if (!fs.existsSync(src)) {
      throw new Error(`ort runtime file missing: ${src}`);
    }
    const dest = path.join(ortDir, f);
    copyFileAtomic(src, dest);
    const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`copy   ${path.relative(ROOT, dest)}  ${mb}MB`);
  }
  console.log(`ort 版本 ${actual} 与 model-registry.ORT_VERSION 一致`);
}

async function downloadFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`skip   ${path.relative(ROOT, dest)}`);
    return fs.statSync(dest).size;
  }
  process.stdout.write(`fetch  ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileAtomic(dest, buf);
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)}MB`);
  return buf.length;
}

/** MODNet photographic 权重:本地参考仓库复制,无外网也能准备资产。 */
async function fetchModnetPhotographic() {
  const dest = path.join(MODNET_DIR, 'modnet_photographic.onnx');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`[modnet] already present: ${path.relative(ROOT, dest)}`);
    return;
  }
  const local = MODNET_LOCAL_CANDIDATES.find(p => fs.existsSync(p));
  if (!local) {
    throw new Error(
      'modnet_photographic.onnx not found. Place it at vendor/modnet_photographic.onnx,\n' +
        'or set MODNET_LOCAL_PATH / ID_PHOTO_REF_ROOT to a local reference checkout.\n' +
        '(source: https://github.com/you-xiu/id_photo_bg_changer/blob/main/pictone/models/modnet_photographic.onnx)'
    );
  }
  fs.mkdirSync(MODNET_DIR, { recursive: true });
  copyFileAtomic(local, dest);
  console.log(
    `[modnet] copied from ${local} -> ${path.relative(ROOT, dest)} (${fs.statSync(dest).size} bytes)`
  );
}

/** YuNet 人脸检测:优先本地复制,缺失时回落 OpenCV Zoo 下载。 */
async function fetchYunet() {
  const dest = path.join(YUNET_DIR, 'face_detection_yunet_2023mar.onnx');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`[yunet] already present: ${path.relative(ROOT, dest)}`);
    return;
  }
  const local = YUNET_LOCAL_CANDIDATES.find(p => fs.existsSync(p));
  if (local) {
    fs.mkdirSync(YUNET_DIR, { recursive: true });
    copyFileAtomic(local, dest);
    console.log(
      `[yunet] copied from ${local} -> ${path.relative(ROOT, dest)} (${fs.statSync(dest).size} bytes)`
    );
    return;
  }
  const size = await downloadFile(YUNET_URL, dest);
  const actual = sha256File(dest);
  if (actual !== YUNET_SHA256) {
    fs.rmSync(dest, { force: true });
    throw new Error(
      `[yunet] sha256 mismatch: expected ${YUNET_SHA256}, got ${actual}. ` +
        `Deleted ${path.relative(ROOT, dest)}.`
    );
  }
  console.log(
    `[yunet] downloaded ${size} bytes -> ${path.relative(ROOT, dest)} (sha256 verified)`
  );
}

async function fetchRmbgModel() {
  for (const f of MODEL_FILES) {
    await download(HF + f, path.join(MODEL_DIR, f));
  }
}

function fetchOrtRuntime() {
  copyOrt();
}

async function main() {
  const which = process.argv[2] || 'all';
  const tasks = {
    model: fetchRmbgModel,
    runtime: fetchOrtRuntime,
    modnet: fetchModnetPhotographic,
    yunet: fetchYunet,
  };

  if (which === 'all') {
    // all 保持既有语义:先 RMBG + ort,再新增的两项资产。
    for (const fn of Object.values(tasks)) await fn();
  } else if (tasks[which]) {
    await tasks[which]();
  } else {
    console.error(
      `unknown target: ${which}. use one of: ${Object.keys(tasks).join(', ')}, all`
    );
    process.exit(1);
  }
  console.log('done');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
