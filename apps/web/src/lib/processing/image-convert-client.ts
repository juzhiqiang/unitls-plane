import {
  transformImage,
  type ImageTransformOptions,
} from './image-transform-client';
import { assertEncodedAs } from './image-encoding-support';

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
  const img = await loadImage(preparedFile);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.drawImage(img, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) return reject(new Error('Conversion failed'));
        try {
          // toBlob 对不支持的格式会静默回退成 PNG,这里拦住,避免产出
          // 扩展名与内容不符的文件。
          assertEncodedAs(blob, toType);
        } catch (error) {
          return reject(error);
        }
        resolve(
          new File([blob], getConvertedImageName(file.name, toType), {
            type: toType,
          })
        );
      },
      toType,
      quality
    );
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
