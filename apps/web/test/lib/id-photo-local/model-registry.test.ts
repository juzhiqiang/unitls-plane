import { describe, expect, it, afterEach } from 'vitest';
import {
  ID_PHOTO_MODELS,
  MODNET_MODEL_FILE,
  ORT_VERSION,
  YUNET_INPUT_SIZE,
  YUNET_MODEL_FILE,
  modnetModelUrl,
  ortWasmPath,
  tierFor,
  yunetModelUrl,
} from '@/lib/id-photo-local/model-registry';

describe('model-registry', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  });

  it('两档共用同一份 photographic fp32 权重与真实体积', () => {
    // photographic 单档:high 不再是 RMBG fp32 退路,元数据与 balanced 一致。
    expect(ID_PHOTO_MODELS.balanced).toEqual({
      dtype: 'fp32',
      requiresWebGpu: false,
      sizeBytes: 25_969_398,
    });
    expect(ID_PHOTO_MODELS.high).toEqual(ID_PHOTO_MODELS.balanced);
  });

  it('主分割指向自托管的 MODNet photographic 权重', () => {
    process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
    expect(MODNET_MODEL_FILE).toBe('modnet_photographic.onnx');
    expect(modnetModelUrl()).toBe(
      'http://localhost:9000/models/modnet/modnet_photographic.onnx'
    );
  });

  it('人脸检测指向自托管的 YuNet 2023mar 权重', () => {
    process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
    expect(YUNET_MODEL_FILE).toBe('face_detection_yunet_2023mar.onnx');
    expect(yunetModelUrl()).toBe(
      'http://localhost:9000/models/face/yunet/face_detection_yunet_2023mar.onnx'
    );
  });

  it('YuNet 输入尺寸与 2023mar 权重一致(固定 640)', () => {
    expect(YUNET_INPUT_SIZE).toBe(640);
  });

  it('builds the ort wasm path (自托管,避免离线镜像回落到 jsDelivr)', () => {
    process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
    // 路径必须带 ort 版本:资产是 immutable 长缓存,升级 ort 时靠路径变化破缓存,
    // 否则浏览器会继续用旧 wasm,与新 JS glue 错配(实测报 _OrtGetInputOutputMetadata)。
    expect(ortWasmPath()).toBe(
      `http://localhost:9000/models/ort/${ORT_VERSION}/`
    );
    expect(ortWasmPath()).toContain(ORT_VERSION);
  });

  it('throws when NEXT_PUBLIC_S3_PUBLIC_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
    expect(() => modnetModelUrl()).toThrow();
    expect(() => yunetModelUrl()).toThrow();
    expect(() => ortWasmPath()).toThrow();
  });

  it('tierFor 恒定落到 balanced(photographic 单档,兼容既有 tier 参数)', () => {
    expect(tierFor(false, 'high')).toBe('balanced');
    expect(tierFor(true, 'high')).toBe('balanced');
    expect(tierFor(true, 'balanced')).toBe('balanced');
    expect(tierFor(false, 'balanced')).toBe('balanced');
  });
});
