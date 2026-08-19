import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeImage, withDecodedImage } from '../image-bitmap';

function blob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('decodeImage', () => {
  it('prefers createImageBitmap and asks for EXIF orientation', async () => {
    const close = vi.fn();
    const create = vi.fn(async () => ({ width: 120, height: 80, close }));
    vi.stubGlobal('createImageBitmap', create);

    const image = await decodeImage(blob());

    expect(image.width).toBe(120);
    expect(image.height).toBe(80);
    // createImageBitmap 早期默认不应用 EXIF 方向,必须显式声明,
    // 否则竖拍照片在部分浏览器上会躺倒。
    expect(create).toHaveBeenCalledWith(expect.anything(), {
      imageOrientation: 'from-image',
    });

    image.close();
    expect(close).toHaveBeenCalled();
  });

  it('retries without the option when the browser rejects it', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('unsupported option'))
      .mockResolvedValueOnce({ width: 10, height: 10, close: vi.fn() });
    vi.stubGlobal('createImageBitmap', create);

    await expect(decodeImage(blob())).resolves.toMatchObject({ width: 10 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]).toHaveLength(1);
  });

  it('falls back to an img element when createImageBitmap is missing', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    stubImageElement({ naturalWidth: 64, naturalHeight: 32 });

    const image = await decodeImage(blob());
    expect(image.width).toBe(64);
    expect(image.height).toBe(32);
    // <img> 路径没有底层资源要释放,close 必须是安全的空操作。
    expect(() => image.close()).not.toThrow();
  });

  it('falls back to an img element when createImageBitmap throws', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('decode failed'))
    );
    stubImageElement({ naturalWidth: 7, naturalHeight: 9 });

    await expect(decodeImage(blob())).resolves.toMatchObject({ width: 7 });
  });

  it('rejects with the shared message when nothing can decode it', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    stubImageElement({ fail: true });

    await expect(decodeImage(blob())).rejects.toThrow('Failed to load image');
  });
});

describe('withDecodedImage', () => {
  it('closes the image after the callback resolves', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1, close }))
    );

    await expect(withDecodedImage(blob(), () => 'done')).resolves.toBe('done');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the image even when the callback throws', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1, close }))
    );

    await expect(
      withDecodedImage(blob(), () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // 忘记 close 会把解码后的位图一直留在内存里,批量处理时很快堆爆。
    expect(close).toHaveBeenCalledTimes(1);
  });
});

/** 让 `new Image()` 在赋值 src 后同步触发 onload / onerror。 */
function stubImageElement(options: {
  naturalWidth?: number;
  naturalHeight?: number;
  fail?: boolean;
}) {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:stub'),
    revokeObjectURL: vi.fn(),
  });

  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = options.naturalWidth ?? 0;
    naturalHeight = options.naturalHeight ?? 0;
    set src(_value: string) {
      queueMicrotask(() => (options.fail ? this.onerror?.() : this.onload?.()));
    }
  }
  vi.stubGlobal('Image', FakeImage);
}

describe('decodeImage HEIC', () => {
  function heicBlob(): Blob {
    const bytes = new Uint8Array(12);
    bytes.set([0, 0, 0, 24], 0);
    bytes.set(
      [...'ftyp'].map(c => c.charCodeAt(0)),
      4
    );
    bytes.set(
      [...'heic'].map(c => c.charCodeAt(0)),
      8
    );
    return new Blob([bytes]);
  }

  it('uses the native decoder when it can handle HEIC (Safari)', async () => {
    // Safari 原生就能解 HEIC,不该让这些用户白下 3MB 的 WASM。
    const create = vi.fn(async () => ({
      width: 4032,
      height: 3024,
      close: vi.fn(),
    }));
    vi.stubGlobal('createImageBitmap', create);

    await expect(decodeImage(heicBlob())).resolves.toMatchObject({
      width: 4032,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('falls back to the wasm decoder when the browser cannot decode HEIC', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('unsupported'))
    );
    const close = vi.fn();
    vi.doMock('heic-to/next', () => ({
      heicTo: vi.fn(async () => ({ width: 100, height: 200, close })),
    }));

    const { decodeImage: fresh } = await import('../image-bitmap');
    const image = await fresh(heicBlob());

    expect(image.width).toBe(100);
    expect(image.height).toBe(200);
    image.close();
    expect(close).toHaveBeenCalled();

    vi.doUnmock('heic-to/next');
  });
});
