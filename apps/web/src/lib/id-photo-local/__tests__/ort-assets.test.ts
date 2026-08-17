import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const publicOnnx = resolve(process.cwd(), 'public', 'onnx');

describe('ORT wasm assets', () => {
  // WebGPU 用的 JSEP wasm 是核心,必须存在;纯 wasm 兜底文件尽量存在
  it('copies the JSEP wasm for WebGPU to public/onnx', () => {
    expect(existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.jsep.wasm'))).toBe(true);
    expect(existsSync(resolve(publicOnnx, 'ort-wasm-simd-threaded.jsep.mjs'))).toBe(true);
  });
});
