import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const publicOnnx = resolve(process.cwd(), 'public', 'onnx');

describe('ORT wasm assets', () => {
  // ort.webgpu.bundle.min.mjs(onnxruntime-web/webgpu 入口)硬编码加载
  // ort-wasm-simd-threaded.asyncify.{wasm,mjs};asyncify 缺失会运行时 404 导致推理失败。
  it('copies the asyncify wasm variant (actually loaded by the WebGPU bundle) to public/onnx', () => {
    expect(
      existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.asyncify.wasm')),
    ).toBe(true);
    expect(
      existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.asyncify.mjs')),
    ).toBe(true);
  });

  // JSEP 与 plain 作保险一并复制;JSEP 供 WebGPU 备选,plain 供 CPU 兜底。
  it('copies the JSEP and plain wasm variants (fallback) to public/onnx', () => {
    expect(
      existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.jsep.wasm')),
    ).toBe(true);
    expect(
      existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.jsep.mjs')),
    ).toBe(true);
    expect(
      existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.wasm')),
    ).toBe(true);
    expect(
      existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.mjs')),
    ).toBe(true);
  });
});
