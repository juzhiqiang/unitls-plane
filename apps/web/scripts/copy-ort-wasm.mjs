// 把 onnxruntime-web 的 JSEP wasm(供 WebGPU)与普通 wasm(供 CPU 兜底)复制到 public/onnx/,
// 保证离线部署不依赖 jsDelivr。版本号必须与 package.json 的 onnxruntime-web 一致。
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const dest = join(__dirname, '..', 'public', 'onnx');

const files = [
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
