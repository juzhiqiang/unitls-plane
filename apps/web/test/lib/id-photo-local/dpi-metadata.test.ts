import { describe, expect, it } from 'vitest';
import {
  injectJpegDpi,
  injectPngDpi,
  writeDpi,
} from '@/lib/id-photo-local/dpi-metadata';

/** 最小的合法 JPEG 结构：SOI + EOI。足以验证段插入逻辑。 */
function minimalJpeg(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xd9, // EOI
  ]);
}

/** 已带 APP1 Exif 的 JPEG：SOI + APP1(Exif\0\0 + 1 字节载荷) + EOI。 */
function jpegWithExif(): Uint8Array<ArrayBuffer> {
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x00];
  const length = payload.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (length >> 8) & 0xff,
    length & 0xff,
    ...payload,
    0xff,
    0xd9,
  ]);
}

/** 最小的合法 PNG 头：签名 + IHDR（附带正确 CRC）。 */
function minimalPng(): Uint8Array<ArrayBuffer> {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array([
    0,
    0,
    0,
    1, // width 1
    0,
    0,
    0,
    1, // height 1
    8,
    6,
    0,
    0,
    0, // bit depth 8, color type 6, rest 0
  ]);
  const ihdr = new Uint8Array([
    0,
    0,
    0,
    13, // length
    73,
    72,
    68,
    82, // 'IHDR'
    ...ihdrData,
    0,
    0,
    0,
    0, // crc placeholder（IHDR 本身不校验 CRC）
  ]);
  const out = new Uint8Array(signature.length + ihdr.length);
  out.set(signature, 0);
  out.set(ihdr, signature.length);
  return out;
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe('injectJpegDpi', () => {
  it('inserts an APP1 Exif segment immediately after SOI', () => {
    const out = injectJpegDpi(minimalJpeg(), 300);

    // SOI 之后紧跟 APP1
    expect(Array.from(out.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe1]);

    // APP1 长度字段包含自身 2 字节，但不含 FF E1 标记
    const view = viewOf(out);
    const segmentLength = view.getUint16(4);
    // out = SOI(2) + marker(2) + 长度字段+载荷 + EOI(2)
    expect(segmentLength).toBe(out.length - 6);

    // 'Exif\0\0' 标识
    expect(Array.from(out.subarray(6, 12))).toEqual([
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    ]);
    expect(latin1(out)).toContain('Exif');
  });

  it('writes XResolution/YResolution = 300 and ResolutionUnit = 2', () => {
    const out = injectJpegDpi(minimalJpeg(), 300);
    const view = viewOf(out);

    // TIFF 头从 offset 12 开始，小端
    expect(Array.from(out.subarray(12, 14))).toEqual([0x49, 0x49]);
    expect(view.getUint16(14, true)).toBe(42);
    expect(view.getUint32(16, true)).toBe(8); // IFD0 相对 TIFF 起点

    const ifd = 12 + 8;
    expect(view.getUint16(ifd, true)).toBe(3); // 3 个条目

    // 条目 1：XResolution RATIONAL @ TIFF offset 50
    expect(view.getUint16(ifd + 2, true)).toBe(0x011a);
    expect(view.getUint16(ifd + 4, true)).toBe(5);
    expect(view.getUint32(ifd + 6, true)).toBe(1);
    expect(view.getUint32(ifd + 10, true)).toBe(50);
    // 条目 2：YResolution RATIONAL @ TIFF offset 58
    expect(view.getUint16(ifd + 14, true)).toBe(0x011b);
    expect(view.getUint32(ifd + 22, true)).toBe(58);
    // 条目 3：ResolutionUnit SHORT = 2（内联值）
    expect(view.getUint16(ifd + 26, true)).toBe(0x0128);
    expect(view.getUint16(ifd + 28, true)).toBe(3);
    expect(view.getUint32(ifd + 34, true)).toBe(2);

    // rational 数据：dpi / 1
    expect(view.getUint32(12 + 50, true)).toBe(300);
    expect(view.getUint32(12 + 54, true)).toBe(1);
    expect(view.getUint32(12 + 58, true)).toBe(300);
    expect(view.getUint32(12 + 62, true)).toBe(1);
  });

  it('is idempotent for already-tagged images', () => {
    const once = injectJpegDpi(minimalJpeg(), 300);
    const twice = injectJpegDpi(once, 300);

    const count = (latin1(twice).match(/Exif/g) ?? []).length;
    expect(count).toBe(1);
    expect(twice).toEqual(once);
  });

  it('leaves an existing Exif APP1 untouched', () => {
    const original = jpegWithExif();
    expect(injectJpegDpi(original, 300)).toBe(original);
  });

  it('returns non-JPEG input unchanged', () => {
    const input = new Uint8Array([1, 2, 3]);
    expect(injectJpegDpi(input, 300)).toBe(input);
  });
});

describe('injectPngDpi', () => {
  it('inserts a pHYs chunk after IHDR', () => {
    const out = injectPngDpi(minimalPng(), 300);
    const ascii = latin1(out);
    expect(ascii).toContain('pHYs');
    expect(ascii.indexOf('pHYs')).toBeGreaterThan(ascii.indexOf('IHDR'));
  });

  it('encodes 300 dpi as 11811 pixels per metre', () => {
    const out = injectPngDpi(minimalPng(), 300);
    const view = viewOf(out);
    const idx = latin1(out).indexOf('pHYs');

    expect(view.getUint32(idx - 4)).toBe(9); // data length
    // 4 字节长度 + 4 字节类型 + 4 字节 X + 4 字节 Y + 1 字节 unit
    const ppuX = view.getUint32(idx + 4);
    const ppuY = view.getUint32(idx + 8);
    expect(ppuX).toBe(11811);
    expect(ppuY).toBe(11811);
    expect(view.getUint8(idx + 12)).toBe(1);
  });

  it('writes a valid CRC32 over type + data', () => {
    const out = injectPngDpi(minimalPng(), 300);
    const idx = latin1(out).indexOf('pHYs');
    const view = viewOf(out);
    // 'pHYs' + 9 bytes data = 13 bytes, CRC 紧随其后
    const expected = crc32(out.subarray(idx, idx + 13));
    expect(view.getUint32(idx + 13)).toBe(expected);
    // 与已知值交叉校验（300dpi / unit=metre）
    expect(expected).toBe(0x78a53f76);
  });

  it('is idempotent when pHYs already exists', () => {
    const once = injectPngDpi(minimalPng(), 300);
    expect(injectPngDpi(once, 300)).toBe(once);
  });

  it('returns non-PNG input unchanged', () => {
    const input = new Uint8Array([1, 2, 3]);
    expect(injectPngDpi(input, 300)).toBe(input);
  });
});

describe('writeDpi', () => {
  it('dispatches by blob type and preserves the media type', async () => {
    const jpeg = new Blob([minimalJpeg()], { type: 'image/jpeg' });
    const outJpeg = await writeDpi(jpeg, 300);
    expect(outJpeg.type).toBe('image/jpeg');
    expect(latin1(new Uint8Array(await outJpeg.arrayBuffer()))).toContain(
      'Exif'
    );

    const png = new Blob([minimalPng()], { type: 'image/png' });
    const outPng = await writeDpi(png, 300);
    expect(outPng.type).toBe('image/png');
    expect(latin1(new Uint8Array(await outPng.arrayBuffer()))).toContain(
      'pHYs'
    );
  });

  it('defaults to 300 dpi', async () => {
    const blob = new Blob([minimalPng()], { type: 'image/png' });
    const out = await writeDpi(blob);
    const view = viewOf(new Uint8Array(await out.arrayBuffer()));
    const idx = latin1(new Uint8Array(await out.arrayBuffer())).indexOf('pHYs');
    expect(view.getUint32(idx + 4)).toBe(11811);
  });

  it('leaves unsupported media types unchanged', async () => {
    const blob = new Blob(['abc'], { type: 'image/webp' });
    expect(await writeDpi(blob, 300)).toBe(blob);
  });
});

/** 独立于实现的 CRC32（ISO-HDLC），用于校验注入结果。 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
