/**
 * 统一的图片解码入口。
 *
 * 此前 loadImage 在 image-transform / image-convert / image-watermark /
 * image-stitch / image-animation 五个文件里逐字重复了五份,各自 new Image() +
 * createObjectURL。合并成一处的收益不只是去重:
 *
 * 1. createImageBitmap 在浏览器内部线程解码,不占主线程;
 * 2. 产出的 ImageBitmap 可以 transfer 给 Worker(后续把画布处理搬出主线程的前提);
 * 3. imageOrientation 显式声明,EXIF 方向的处理在所有工具里一致 —— createImageBitmap
 *    早期规范默认是 'none'(不应用 EXIF 方向),与 <img> 的行为相反,不显式指定会
 *    在部分浏览器上得到躺倒的照片。
 */

import { decodeHeicToBitmap, isHeicBlob } from './image-heic';

export interface DecodedImage {
  /** 可直接喂给 ctx.drawImage 的源。 */
  source: CanvasImageSource;
  width: number;
  height: number;
  /** 释放底层资源;ImageBitmap 必须显式关闭,否则要等 GC。 */
  close(): void;
}

function decodeViaElement(blob: Blob): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => {},
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    image.src = url;
  });
}

function wrapBitmap(bitmap: ImageBitmap): DecodedImage {
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close?.(),
  };
}

async function decodeViaBitmap(blob: Blob): Promise<DecodedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // 老浏览器不认 imageOrientation 选项,退回两参调用而不是直接失败。
    bitmap = await createImageBitmap(blob);
  }

  return wrapBitmap(bitmap);
}

/**
 * 解码一张图片。
 *
 * 顺序有意为之:
 * 1. 先试 createImageBitmap —— 覆盖绝大多数图片,Safari 下连 HEIC 也一并解掉;
 * 2. 失败后才判断是不是 HEIC,是才懒加载 3MB 的 WASM 解码器。这样非 HEIC 用户
 *    完全不用为 HEIC 支持付出任何代价,连读魔数的那几字节都省了;
 * 3. 再退回 <img>,两种解码器能覆盖的损坏文件不完全重合,兜一层能救回一部分。
 *
 * 解码失败一律抛 `Failed to load image`,与替换前的行为保持一致 —— 调用方和
 * 既有文案都依赖这个信息。
 */
export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await decodeViaBitmap(blob);
    } catch {
      // 落到下面的 HEIC / <img> 分支
    }
  }

  if (await isHeicBlob(blob)) {
    return wrapBitmap(await decodeHeicToBitmap(blob));
  }

  return decodeViaElement(blob);
}

/**
 * 解码、交给回调使用,然后必定释放。
 *
 * ImageBitmap 忘记 close 会一直占着解码后的位图内存,批量处理时很容易堆爆,
 * 用这个包一层就不会漏。
 */
export async function withDecodedImage<T>(
  blob: Blob,
  use: (image: DecodedImage) => Promise<T> | T
): Promise<T> {
  const image = await decodeImage(blob);
  try {
    return await use(image);
  } finally {
    image.close();
  }
}
