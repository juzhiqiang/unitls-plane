import imageCompression from 'browser-image-compression';
import {
  transformImage,
  type ImageTransformOptions,
} from './image-transform-client';
import {
  canEncodeImageType,
  type EncodableImageType,
} from './image-encoding-support';
import { withDecodedImage } from './image-bitmap';

export interface CompressOptions {
  /**
   * 目标体积上限(MB)。仅「压缩到指定大小」模式传入。
   *
   * 不传即不限制:browser-image-compression 内部默认 POSITIVE_INFINITY,
   * 此时输出体积完全由 quality 决定。曾经这里写死 `?? 1`,导致质量滑杆
   * 无论调到多少,结果都被迭代降质压到 1MB 以内。
   */
  maxSizeMB?: number;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputType?: EncodableImageType;
  transform?: ImageTransformOptions;
  /** 保留 EXIF(拍摄参数、GPS 等)。默认 false,即重编码时抹除。 */
  preserveExif?: boolean;
  onProgress?: (progress: number) => void;
}

/**
 * 旋转/翻转产生的中间文件所用的编码质量。
 *
 * 这是一次中间产物,后面还会被 imageCompression 再编码一次。若此处也用用户设定的
 * quality,同一份画质损失会叠加两遍(例如 60% × 60%)。固定取高质量,把唯一一次
 * 有意义的降质留给最终编码。
 */
const INTERMEDIATE_TRANSFORM_QUALITY = 0.95;

export async function compressImage(
  file: File,
  options: CompressOptions = {}
): Promise<File> {
  // browser-image-compression 内部也走 canvas.toBlob,对不支持的格式会静默回退成
  // PNG。先拦一次,免得用户拿到扩展名与内容不符的文件。
  if (options.outputType && !(await canEncodeImageType(options.outputType))) {
    throw new Error(`Browser cannot encode ${options.outputType}`);
  }

  const preparedFile = await transformImage(
    file,
    options.transform ?? {},
    options.outputType ?? file.type,
    INTERMEDIATE_TRANSFORM_QUALITY
  );
  const longestEdge =
    options.maxWidth || options.maxHeight
      ? Math.max(options.maxWidth ?? 0, options.maxHeight ?? 0)
      : undefined;

  return imageCompression(preparedFile, {
    ...(options.maxSizeMB !== undefined && { maxSizeMB: options.maxSizeMB }),
    ...(longestEdge !== undefined && { maxWidthOrHeight: longestEdge }),
    initialQuality: options.quality ?? 0.8,
    fileType: options.outputType,
    preserveExif: options.preserveExif ?? false,
    useWebWorker: true,
    onProgress: options.onProgress,
  });
}

export function shouldProcessLocally(file: File): boolean {
  return file.size < 5 * 1024 * 1024;
}

export interface ImageMeta {
  width: number;
  height: number;
  size: number;
  type: string;
}

export async function getImageMeta(file: File): Promise<ImageMeta> {
  return withDecodedImage(file, image => ({
    width: image.width,
    height: image.height,
    size: file.size,
    type: file.type,
  }));
}
