// 把 onnxruntime-web 的 wasm 变体复制到 public/onnx/,保证离线部署不依赖 jsDelivr。
// 版本号必须与 package.json 的 onnxruntime-web 一致。
//
// 变体选择依据:ort.webgpu.bundle.min.mjs(即 onnxruntime-web/webgpu 入口)硬编码引用
// ort-wasm-simd-threaded.asyncify.{wasm,mjs}(经 locateFile + new URL(..., import.meta.url)
// 共 5 处),jsep/jspi/plain 变体 0 处。因此 asyncify 才是 WebGPU 入口真正加载的变体,
// 必须自托管,否则运行时 404 导致推理失败。jsep/plain 作为保险一并复制。
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(__dirname, '..', 'public', 'onnx');

const files = [
  // WebGPU bundle 实际加载(asyncify 必须存在,否则 404)
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  // 保险:JSEP(WebGPU 备选)与 plain(CPU 兜底)
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
];

if (!existsSync(src)) {
  console.warn('[copy-ort-wasm] onnxruntime-web dist not found, skipping');
  process.exit(0);
}
await mkdir(dest, { recursive: true });
for (const f of files) {
  const from = join(src, f);
  if (existsSync(from)) {
    await cp(from, join(dest, f));
    console.log(`[copy-ort-wasm] copied ${f}`);
  } else {
    console.warn(`[copy-ort-wasm] missing ${f}, skipping`);
  }
}
