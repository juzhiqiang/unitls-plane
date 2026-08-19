import { describe, expect, it, afterEach } from 'vitest';
import {
  ID_PHOTO_MODELS,
  RMBG_MODEL_ID,
  RMBG_VERSION,
  modelsBaseUrl,
  ortWasmPath,
  tierFor,
} from '../model-registry';

describe('model-registry', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  });

  it('exposes fp16 (balanced) and fp32 (high) tiers', () => {
    expect(ID_PHOTO_MODELS.balanced.dtype).toBe('fp16');
    expect(ID_PHOTO_MODELS.balanced.requiresWebGpu).toBe(false);
    expect(ID_PHOTO_MODELS.balanced.sizeBytes).toBeGreaterThan(
      80 * 1024 * 1024
    );
    expect(ID_PHOTO_MODELS.high.dtype).toBe('fp32');
    expect(ID_PHOTO_MODELS.high.requiresWebGpu).toBe(true);
    expect(ID_PHOTO_MODELS.high.sizeBytes).toBeGreaterThan(160 * 1024 * 1024);
  });

  it('model id 与版本对齐(与 MinIO 上 models/ 下的相对路径一致)', () => {
    expect(RMBG_MODEL_ID).toBe(`rmbg/${RMBG_VERSION}`);
  });

  it('builds remoteHost pointing at the MinIO models bucket', () => {
    process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
    // 必须以 / 结尾:transformers.js 直接拼 remotePathTemplate
    expect(modelsBaseUrl()).toBe('http://localhost:9000/models/');
  });

  it('builds the ort wasm path (自托管,避免离线镜像回落到 jsDelivr)', () => {
    process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
    expect(ortWasmPath()).toBe('http://localhost:9000/models/ort/');
  });

  it('throws when NEXT_PUBLIC_S3_PUBLIC_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
    expect(() => modelsBaseUrl()).toThrow();
    expect(() => ortWasmPath()).toThrow();
  });

  it('tierFor locks balanced when webgpu unavailable, honors request when available', () => {
    expect(tierFor(false, 'high')).toBe('balanced');
    expect(tierFor(true, 'high')).toBe('high');
    expect(tierFor(true, 'balanced')).toBe('balanced');
  });
});
