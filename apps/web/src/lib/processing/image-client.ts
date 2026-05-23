import imageCompression from 'browser-image-compression';

export interface CompressOptions {
  maxSizeMB?: number;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputType?: 'image/jpeg' | 'image/webp' | 'image/png';
  onProgress?: (progress: number) => void;
}

export async function compressImage(
  file: File,
  options: CompressOptions = {}
): Promise<File> {
  const longestEdge =
    options.maxWidth || options.maxHeight
      ? Math.max(options.maxWidth ?? 0, options.maxHeight ?? 0)
      : undefined;

  return imageCompression(file, {
    maxSizeMB: options.maxSizeMB ?? 1,
    ...(longestEdge !== undefined && { maxWidthOrHeight: longestEdge }),
    initialQuality: options.quality ?? 0.8,
    fileType: options.outputType,
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
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      size: file.size,
      type: file.type,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
