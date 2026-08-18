import { describe, expect, it, afterEach } from 'vitest';
import {
  ID_PHOTO_MODELS,
  IMGLY_VERSION,
  imglyPublicPath,
  tierFor,
} from '../model-registry';

describe('model-registry', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  });

  it('exposes isnet_fp16 (balanced) and isnet (high) tiers', () => {
    expect(ID_PHOTO_MODELS.balanced.model).toBe('isnet_fp16');
    expect(ID_PHOTO_MODELS.balanced.requiresWebGpu).toBe(false);
    expect(ID_PHOTO_MODELS.balanced.sizeBytes).toBeGreaterThan(
      80 * 1024 * 1024,
    );
    expect(ID_PHOTO_MODELS.high.model).toBe('isnet');
    expect(ID_PHOTO_MODELS.high.requiresWebGpu).toBe(true);
    expect(ID_PHOTO_MODELS.high.sizeBytes).toBeGreaterThan(160 * 1024 * 1024);
  });

  it('builds the publicPath to the versioned MinIO dist dir', () => {
    process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
    expect(imglyPublicPath()).toBe(
      `http://localhost:9000/models/imgly/${IMGLY_VERSION}/dist/`,
    );
  });

  it('throws when NEXT_PUBLIC_S3_PUBLIC_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
    expect(() => imglyPublicPath()).toThrow();
  });

  it('tierFor locks balanced when webgpu unavailable, honors request when available', () => {
    expect(tierFor(false, 'high')).toBe('balanced');
    expect(tierFor(true, 'high')).toBe('high');
    expect(tierFor(true, 'balanced')).toBe('balanced');
  });
});
