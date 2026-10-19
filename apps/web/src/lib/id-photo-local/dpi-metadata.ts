/**
 * 给 canvas 产物补写 DPI 元数据。
 *
 * canvas 的 `toBlob` 不写任何分辨率信息 —— 拿到的是「295×413 像素，但没有密度」
 * 的文件，打印时会按 72dpi 解释成 10×14cm 的巨幅照片。而证件照的像素规格本身
 * 就是按 300dpi 定的（295px ≈ 25mm），必须把密度写回去，拼版与冲印才对得上。
 *
 * 两条路径都是纯二进制操作，不引第三方库：
 * - JPEG：插入 APP1 Exif 段，XResolution/YResolution = dpi，ResolutionUnit = 2 (inch)
 * - PNG：插入 pHYs chunk，pixels-per-unit = dpi / 0.0254
 */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const PNG_HEADER_SIZE = 8 + 25; // signature + IHDR(4 len + 4 type + 13 data + 4 crc)
const INCHES_PER_METRE = 0.0254;

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    crc ^= bytes[i]!;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * 构造最小的 TIFF 结构 Exif 载荷，只含 XResolution/YResolution/ResolutionUnit。
 *
 * 布局（全部小端）：
 *   0  TIFF header: 'II', 42, IFD0 offset = 8          (8 bytes)
 *   8  IFD0: count=3, 3×12 字节条目, next IFD = 0     (42 bytes)
 *  50  XResolution rational (dpi/1)                   (8 bytes)
 *  58  YResolution rational (dpi/1)                   (8 bytes)
 *
 * 注意条目内联值只有 4 字节：SHORT 放在前 2 字节；RATIONAL 存的是相对
 * TIFF 起点的偏移，数据区必须排在 IFD 之后，不能和条目重叠。
 */
function buildExifPayload(dpi: number): Uint8Array {
  const TIFF_HEADER_SIZE = 8;
  const IFD_OFFSET = 8;
  const ENTRY_COUNT = 3;
  const IFD_SIZE = 2 + ENTRY_COUNT * 12 + 4;
  const X_RESOLUTION_OFFSET = IFD_OFFSET + IFD_SIZE;
  const Y_RESOLUTION_OFFSET = X_RESOLUTION_OFFSET + 8;
  const out = new Uint8Array(Y_RESOLUTION_OFFSET + 8);
  const view = new DataView(out.buffer);

  // TIFF header
  out[0] = 0x49; // 'I'
  out[1] = 0x49; // 'I' -> little-endian
  view.setUint16(2, 42, true);
  view.setUint32(4, IFD_OFFSET, true);

  // IFD0
  view.setUint16(IFD_OFFSET, ENTRY_COUNT, true);

  // (1) XResolution (0x011A) = RATIONAL, 1 个, 数据在 X_RESOLUTION_OFFSET
  let entry = IFD_OFFSET + 2;
  view.setUint16(entry, 0x011a, true);
  view.setUint16(entry + 2, 5, true);
  view.setUint32(entry + 4, 1, true);
  view.setUint32(entry + 8, X_RESOLUTION_OFFSET, true);

  // (2) YResolution (0x011B) = RATIONAL
  entry += 12;
  view.setUint16(entry, 0x011b, true);
  view.setUint16(entry + 2, 5, true);
  view.setUint32(entry + 4, 1, true);
  view.setUint32(entry + 8, Y_RESOLUTION_OFFSET, true);

  // (3) ResolutionUnit (0x0128) = SHORT = 2 (inch)，值内联在条目里
  entry += 12;
  view.setUint16(entry, 0x0128, true);
  view.setUint16(entry + 2, 3, true);
  view.setUint32(entry + 4, 1, true);
  view.setUint32(entry + 8, 2, true);

  // next IFD offset = 0（entry+12 处）
  view.setUint32(entry + 12, 0, true);

  // rational 数据
  view.setUint32(X_RESOLUTION_OFFSET, dpi, true);
  view.setUint32(X_RESOLUTION_OFFSET + 4, 1, true);
  view.setUint32(Y_RESOLUTION_OFFSET, dpi, true);
  view.setUint32(Y_RESOLUTION_OFFSET + 4, 1, true);

  return out;
}

/** 扫描 JPEG 的 marker 段，判断是否已有 APP1 Exif。 */
function hasExifApp1(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2; // 跳过 SOI

  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return false;
    const marker = bytes[pos + 1]!;

    // 无长度字段的独立标记
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      pos += 2;
      continue;
    }
    // 扫描数据或图像结束：之后不会再有 APP 段
    if (marker === 0xda || marker === 0xd9) return false;

    const length = view.getUint16(pos + 2);
    if (length < 2 || pos + 2 + length > bytes.length) return false;

    if (
      marker === 0xe1 &&
      length >= 8 &&
      ascii(bytes, pos + 4, pos + 8) === 'Exif'
    ) {
      return true;
    }
    pos += 2 + length;
  }
  return false;
}

/**
 * 在 SOI 之后插入 APP1 Exif 段。
 *
 * 已经带 Exif 的原样返回，避免重复插入把文件撑大（幂等）。
 */
export function injectJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  if (hasExifApp1(bytes)) return bytes;

  const tiff = buildExifPayload(dpi);
  const identifier = new Uint8Array([
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00, // 'Exif\0\0'
  ]);
  const payloadLength = identifier.length + tiff.length;
  const app1 = new Uint8Array(4 + payloadLength);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  // APP1 长度字段包含它自己（2 字节），不含标记本身
  app1[2] = ((payloadLength + 2) >> 8) & 0xff;
  app1[3] = (payloadLength + 2) & 0xff;
  app1.set(identifier, 4);
  app1.set(tiff, 4 + identifier.length);

  const out = new Uint8Array(bytes.length + app1.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(bytes.subarray(2), 2 + app1.length);
  return out;
}

/** 扫描 PNG chunk，判断是否已有 pHYs。 */
function hasPhysChunk(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8; // 跳过签名
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos);
    if (pos + 12 + length > bytes.length) return false;
    if (ascii(bytes, pos + 4, pos + 8) === 'pHYs') return true;
    pos += 12 + length;
  }
  return false;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

/**
 * 在 IHDR 之后插入 pHYs chunk。
 *
 * pHYs 是 PNG 唯一表达物理像素密度的标准块，单位固定为「每米像素数」。
 */
export function injectPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (!hasPngSignature(bytes) || bytes.length < PNG_HEADER_SIZE) return bytes;
  if (ascii(bytes, 12, 16) !== 'IHDR') return bytes;
  if (hasPhysChunk(bytes)) return bytes;

  // pHYs：4(len) + 4(type) + 9(data) + 4(crc)
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  const ppm = Math.round(dpi / INCHES_PER_METRE); // 300 dpi ≈ 11811 px/m

  view.setUint32(0, 9); // data length
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk, 4, 17));

  const insertAt = PNG_HEADER_SIZE;
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(bytes.subarray(insertAt), insertAt + chunk.length);
  return out;
}

/** 按 blob 的实际类型分派，返回带 DPI 的新 blob。 */
export async function writeDpi(blob: Blob, dpi = 300): Promise<Blob> {
  const type = blob.type.toLowerCase();
  if (type !== 'image/png' && type !== 'image/jpeg' && type !== 'image/jpg') {
    return blob;
  }

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const tagged =
      type === 'image/png'
        ? injectPngDpi(bytes, dpi)
        : injectJpegDpi(bytes, dpi);
    // 复制到 ArrayBuffer 支撑的视图，满足 BlobPart 的类型约束
    const payload = new Uint8Array(tagged.length);
    payload.set(tagged);
    return new Blob([payload], { type: blob.type });
  } catch {
    // 注入失败不能阻断下载
    return blob;
  }
}
