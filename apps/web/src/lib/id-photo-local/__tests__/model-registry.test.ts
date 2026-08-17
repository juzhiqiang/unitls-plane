import { describe, expect, it, afterEach } from 'vitest';
import {
  ID_PHOTO_MODELS,
  modelUrl,
  tierFor,
  type ModelTier,
} from '../model-registry';

describe('model-registry', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  });

  it('exposes balanced and high tiers', () => {
    expect(ID_PHOTO_MODELS.balanced.key).toBe('rmbg-1.4');
    expect(ID_PHOTO_MODELS.balanced.quant).toBe('fp16');
    expect(ID_PHOTO_MODELS.balanced.sizeBytes).toBeGreaterThan(
      80 * 1024 * 1024
    );
    expect(ID_PHOTO_MODELS.high.key).toBe('rmbg-2.0');
    expect(ID_PHOTO_MODELS.high.quant).toBe('q4f16');
    expect(ID_PHOTO_MODELS.high.sizeBytes).toBeGreaterThan(230 * 1024 * 1024);
  });

  it('builds the public object URL from NEXT_PUBLIC_S3_PUBLIC_URL', () => {
    process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
    expect(modelUrl(ID_PHOTO_MODELS.balanced)).toBe(
      'http://localhost:9000/models/rmbg-1.4-fp16.onnx'
    );
  });

  it('tierFor locks balanced when webgpu unavailable, honors request when available', () => {
    expect(tierFor(false, 'high')).toBe('balanced');
    expect(tierFor(true, 'high')).toBe('high');
    expect(tierFor(true, 'balanced')).toBe('balanced');
  });
});
