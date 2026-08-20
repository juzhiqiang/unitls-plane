import {
  transformImage,
  type ImageTransformOptions,
} from './image-transform-client';
import { assertEncodedAs } from './image-encoding-support';
import { withDecodedImage } from './image-bitmap';
import { createSurface } from './canvas-surface';
import { runInImageWorker } from './image-worker-client';

export type ImageOutputType =
  | 'image/jpeg'
  | 'image/webp'
  | 'image/png'
  | 'image/avif';

const OUTPUT_EXTENSIONS: Record<ImageOutputType, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
  'image/avif': 'avif',
};

/** 转换目标格式对应的服务端 format 值。 */
export const SERVER_CONVERT_FORMATS: Record<ImageOutputType, string> = {
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/png': 'png',
  'image/avif': 'avif',
};

export function getConvertedImageName(
  filename: string,
  toType: ImageOutputType
): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}.${OUTPUT_EXTENSIONS[toType]}`;
}

export async function convertImageFormat(
  file: File,
  toType: ImageOutputType,
  quality = 0.9,
  transform: ImageTransformOptions = {}
): Promise<File> {
  const preparedFile = await transformImage(file, transform, toType, quality);
  const blob = await runInImageWorker(
    { op: 'convert', blob: preparedFile, toType, quality },
    () => renderConvert(preparedFile, toType, quality)
  );
  return new File([blob], getConvertedImageName(file.name, toType), {
    type: toType,
  });
}

/**
 * 只做「解码 → 画上去 → 编码」,不碰 File/文件名。
 *
 * 拆出来是为了让同一份实现既能在主线程调用,也能被 Worker 直接复用 —— 命名与
 * File 构造属于调用方的事,Worker 里只需要 Blob 进 Blob 出。
 */
export async function renderConvert(
  source: Blob,
  toType: ImageOutputType,
  quality: number
): Promise<Blob> {
  return withDecodedImage(source, async img => {
    const surface = createSurface(img.width, img.height);
    surface.ctx.drawImage(img.source, 0, 0);

    const blob = await surface.toBlob(toType, quality);
    // toBlob 对不支持的格式会静默回退成 PNG,这里拦住,避免产出扩展名与内容不符的文件。
    assertEncodedAs(blob, toType);
    return blob;
  });
}
