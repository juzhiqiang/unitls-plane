/**
 * HEIC / HEIF 输入支持。
 *
 * iPhone 默认相册格式就是 HEIC。此前 dropzone 的 `image/*` 会把它放进来,然后
 * canvas 解码失败,用户只看到「Failed to load image」,完全不知道发生了什么 ——
 * 这是消费级图片工具最大的一处入口漏斗损失。
 *
 * 解码路径的选择:
 * - Safari / iOS 原生就能解 HEIC,走 createImageBitmap 即可,不该让这些用户白下 3MB;
 * - 其它浏览器没有 HEVC 解码器,服务端 sharp 这个构建同样没有(版本清单里有
 *   heif 与 aom,没有 de265),所以只能上 WASM。
 *
 * 因此 decodeImage 的顺序是「先原生,失败再判断是不是 HEIC,是才懒加载 WASM」,
 * 非 HEIC 用户零额外开销。
 *
 * 许可提醒:heic-to 内含 libheif,LGPL-3.0。分发时需保留其许可声明并保证可重新链接。
 */

/** ISO-BMFF ftyp brand 位于第 8..12 字节。 */
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

/** AVIF 同样是 ftyp 容器,但浏览器原生支持,不该被误判去走 WASM。 */
const AVIF_BRANDS = new Set(['avif', 'avis']);

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  let text = '';
  for (let i = start; i < end; i += 1) {
    text += String.fromCharCode(bytes[i] ?? 0);
  }
  return text.replace(/\0/g, ' ').trim();
}

export function isHeicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (readAscii(bytes, 4, 8) !== 'ftyp') return false;

  const brand = readAscii(bytes, 8, 12);
  if (AVIF_BRANDS.has(brand)) return false;
  return HEIC_BRANDS.has(brand);
}

/**
 * 按魔数判断是否 HEIC。
 *
 * 只读前 12 字节 —— heic-to 自带的 isHeic 会把整个文件读进内存再取 4 个字节,
 * 一张 5MB 的照片就白读一遍。
 */
export async function isHeicBlob(blob: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    return isHeicBytes(head);
  } catch {
    return false;
  }
}

/** 扩展名兜底:部分系统给 .heic 的 File 报空 MIME。 */
export function hasHeicExtension(filename: string): boolean {
  return /\.(heic|heif)$/i.test(filename.trim());
}

/**
 * 用 WASM 解码 HEIC,直接产出 ImageBitmap。
 *
 * 走 `type: 'bitmap'` 而不是先转 PNG/JPEG:PNG 对一张 1200 万像素的照片会撑到
 * 几十 MB,JPEG 又会在用户自己选的质量之前先损失一道。直接要位图两者都避开。
 */
export async function decodeHeicToBitmap(blob: Blob): Promise<ImageBitmap> {
  const { heicTo } = await import('heic-to/next');
  return heicTo({
    blob,
    type: 'bitmap',
    options: { imageOrientation: 'from-image' },
  });
}
