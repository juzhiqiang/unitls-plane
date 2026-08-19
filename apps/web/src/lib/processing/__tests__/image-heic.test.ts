import { describe, expect, it } from 'vitest';
import { hasHeicExtension, isHeicBlob, isHeicBytes } from '../image-heic';

/** 造一个 ISO-BMFF 头:[size][ftyp][brand]。 */
function ftypHeader(brand: string, extra = 0): Uint8Array {
  const bytes = new Uint8Array(12 + extra);
  bytes.set([0, 0, 0, 24], 0);
  bytes.set(
    [...'ftyp'].map(c => c.charCodeAt(0)),
    4
  );
  bytes.set(
    [...brand].map(c => c.charCodeAt(0)),
    8
  );
  return bytes;
}

describe('isHeicBytes', () => {
  it('recognises the iPhone HEIC brands', () => {
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']) {
      expect(isHeicBytes(ftypHeader(brand))).toBe(true);
    }
  });

  it('does not claim AVIF', () => {
    // AVIF 也是 ftyp 容器,但浏览器原生就能解,误判会白下 3MB 的 WASM。
    expect(isHeicBytes(ftypHeader('avif'))).toBe(false);
    expect(isHeicBytes(ftypHeader('avis'))).toBe(false);
  });

  it('rejects other containers and short buffers', () => {
    expect(isHeicBytes(ftypHeader('mp42'))).toBe(false);
    expect(isHeicBytes(ftypHeader('qt  '))).toBe(false);
    // JPEG 魔数
    expect(isHeicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    // PNG 魔数
    expect(
      isHeicBytes(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])
      )
    ).toBe(false);
    expect(isHeicBytes(new Uint8Array([0, 1, 2]))).toBe(false);
    expect(isHeicBytes(new Uint8Array())).toBe(false);
  });
});

describe('isHeicBlob', () => {
  it('reads only the header, not the whole file', async () => {
    const header = ftypHeader('heic');
    const payload = new Uint8Array(1024).fill(7);
    const blob = new Blob([header, payload]);

    let sliced: [number, number] | null = null;
    const original = blob.slice.bind(blob);
    Object.defineProperty(blob, 'slice', {
      value: (start: number, end: number) => {
        sliced = [start, end];
        return original(start, end);
      },
    });

    await expect(isHeicBlob(blob)).resolves.toBe(true);
    // heic-to 自带的 isHeic 会把整个文件读进内存再取 4 字节,我们只读 12 字节。
    expect(sliced).toEqual([0, 12]);
  });

  it('returns false for a non-HEIC blob', async () => {
    const blob = new Blob([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
    ]);
    await expect(isHeicBlob(blob)).resolves.toBe(false);
  });
});

describe('hasHeicExtension', () => {
  it('matches .heic and .heif case-insensitively', () => {
    expect(hasHeicExtension('IMG_0001.HEIC')).toBe(true);
    expect(hasHeicExtension('photo.heif')).toBe(true);
    expect(hasHeicExtension(' shot.heic ')).toBe(true);
    expect(hasHeicExtension('photo.jpg')).toBe(false);
    expect(hasHeicExtension('heic')).toBe(false);
  });
});
