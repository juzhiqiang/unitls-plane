import { withDecodedImage } from './image-bitmap';

export type ImageRotation = 0 | 90 | 180 | 270;

export interface ImageTransformOptions {
  autoOrient?: boolean;
  rotate?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

export interface NormalizedImageTransform {
  autoOrient: boolean;
  rotate: ImageRotation;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export function normalizeImageTransform(
  transform: ImageTransformOptions = {}
): NormalizedImageTransform {
  const normalizedRotation = (((transform.rotate ?? 0) % 360) + 360) % 360;
  const rotate = (
    [0, 90, 180, 270].includes(normalizedRotation) ? normalizedRotation : 0
  ) as ImageRotation;

  return {
    autoOrient: transform.autoOrient ?? true,
    rotate,
    flipHorizontal: transform.flipHorizontal ?? false,
    flipVertical: transform.flipVertical ?? false,
  };
}

export function rotateClockwise(rotation: number): ImageRotation {
  return normalizeImageTransform({ rotate: rotation + 90 }).rotate;
}

export function rotateCounterClockwise(rotation: number): ImageRotation {
  return normalizeImageTransform({ rotate: rotation - 90 }).rotate;
}

export function getTransformedSize(
  width: number,
  height: number,
  transform: ImageTransformOptions = {}
): { width: number; height: number } {
  const { rotate } = normalizeImageTransform(transform);
  return rotate === 90 || rotate === 270
    ? { width: height, height: width }
    : { width, height };
}

export function hasImageTransform(transform?: ImageTransformOptions): boolean {
  const normalized = normalizeImageTransform(transform);
  return (
    normalized.rotate !== 0 ||
    normalized.flipHorizontal ||
    normalized.flipVertical
  );
}

export async function transformImage(
  file: File,
  transform: ImageTransformOptions,
  outputType = file.type || 'image/png',
  quality = 0.92
): Promise<File> {
  const normalized = normalizeImageTransform(transform);
  if (!hasImageTransform(normalized)) return file;

  return withDecodedImage(file, async img => {
    const size = getTransformedSize(img.width, img.height, normalized);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');

    ctx.translate(size.width / 2, size.height / 2);
    ctx.rotate((normalized.rotate * Math.PI) / 180);
    ctx.scale(
      normalized.flipHorizontal ? -1 : 1,
      normalized.flipVertical ? -1 : 1
    );
    ctx.drawImage(img.source, -img.width / 2, -img.height / 2);

    return new Promise<File>((resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (!blob) return reject(new Error('Transform export failed'));
          resolve(new File([blob], file.name, { type: outputType }));
        },
        outputType,
        quality
      );
    });
  });
}

export function toServerTransformConfig(
  transform: ImageTransformOptions
): NormalizedImageTransform {
  return normalizeImageTransform(transform);
}
