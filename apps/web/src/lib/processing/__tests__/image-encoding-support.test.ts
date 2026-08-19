import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertEncodedAs,
  canEncodeImageType,
  resetImageEncodingProbes,
} from '../image-encoding-support';

/**
 * 模拟 canvas.toBlob:`supported` 之外的类型按规范静默回退成 PNG。
 * 这正是 AVIF 曾经会踩到的坑 —— 不报错,只是内容变成了 PNG。
 */
function stubCanvas(supported: readonly string[]) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({}),
    toBlob: (cb: (blob: Blob | null) => void, type: string) => {
      const actual = supported.includes(type) ? type : 'image/png';
      cb(new Blob([new Uint8Array([0])], { type: actual }));
    },
  };
  vi.spyOn(document, 'createElement').mockImplementation(
    () => canvas as unknown as HTMLElement
  );
}

describe('canEncodeImageType', () => {
  beforeEach(() => {
    resetImageEncodingProbes();
    vi.restoreAllMocks();
  });

  it('reports jpeg and png without probing the canvas', async () => {
    const createElement = vi.spyOn(document, 'createElement');

    await expect(canEncodeImageType('image/jpeg')).resolves.toBe(true);
    await expect(canEncodeImageType('image/png')).resolves.toBe(true);
    expect(createElement).not.toHaveBeenCalled();
  });

  it('detects a supported optional format', async () => {
    stubCanvas(['image/webp', 'image/avif']);
    await expect(canEncodeImageType('image/avif')).resolves.toBe(true);
  });

  it('detects the silent png fallback as unsupported', async () => {
    stubCanvas(['image/webp']);
    await expect(canEncodeImageType('image/avif')).resolves.toBe(false);
  });

  it('probes each type only once', async () => {
    stubCanvas(['image/webp']);
    const createElement = vi.spyOn(document, 'createElement');

    await canEncodeImageType('image/avif');
    await canEncodeImageType('image/avif');

    expect(createElement).toHaveBeenCalledTimes(1);
  });
});

describe('assertEncodedAs', () => {
  it('accepts a blob whose type matches the request', () => {
    expect(() =>
      assertEncodedAs(new Blob([], { type: 'image/avif' }), 'image/avif')
    ).not.toThrow();
  });

  it('rejects a silently downgraded blob', () => {
    expect(() =>
      assertEncodedAs(new Blob([], { type: 'image/png' }), 'image/avif')
    ).toThrow(/image\/avif/);
  });
});
