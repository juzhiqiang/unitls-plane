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
//
// ort 运行时直接从 node_modules 复制,而不是从 CDN 下载 —— 保证与
// @huggingface/transformers 实际依赖的 ort 版本严格一致(版本错配会导致
// wasm 与 glue 的导出对不上,例如 jsepInit/webgpuInit 之争,见 git 历史)。
//
// 许可提醒:RMBG-1.4 为 BRIA 自有许可(HF 标注 license: other),商用需向 BRIA 申请授权。
//
// 用法: node scripts/download-rmbg-assets.cjs [model|runtime|all]
const fs = require('fs');
const path = require('path');

const VERSION = '1.4';
const REPO = 'briaai/RMBG-1.4';
const HF = `https://huggingface.co/${REPO}/resolve/main/`;

const ROOT = path.join(__dirname, '..');
// 落到 docker/models/,与 Dockerfile `COPY docker/models/ ./models/id-photo/` 对齐
const MODEL_DIR = path.join(ROOT, 'docker', 'models', 'rmbg', VERSION);
const ORT_DIR = path.join(ROOT, 'docker', 'models', 'ort');

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
  fs.writeFileSync(dest, buf);
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)}MB`);
}

function copyOrt() {
  const dist = ortDistDir();
  fs.mkdirSync(ORT_DIR, { recursive: true });
  for (const f of ORT_FILES) {
    const src = path.join(dist, f);
    if (!fs.existsSync(src)) {
      throw new Error(`ort runtime file missing: ${src}`);
    }
    const dest = path.join(ORT_DIR, f);
    fs.copyFileSync(src, dest);
    const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`copy   ${path.relative(ROOT, dest)}  ${mb}MB`);
  }
}

async function main() {
  const which = process.argv[2] || 'all';
  if (which === 'model' || which === 'all') {
    for (const f of MODEL_FILES) {
      await download(HF + f, path.join(MODEL_DIR, f));
    }
  }
  if (which === 'runtime' || which === 'all') {
    copyOrt();
  }
  console.log('done');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
