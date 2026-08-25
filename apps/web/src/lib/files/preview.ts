/**
 * 文件预览能力判定。
 *
 * 预览与下载是两个独立动作：预览用内联链接（`Content-Disposition: inline`），
 * 下载走 `?download=1`，见 `file-download.ts`。
 */
export type FilePreviewKind = 'image' | 'pdf' | 'none';

export interface PreviewableFile {
  mimeType: string;
  originalSize: number;
}

/** 网格缩略图直接加载原图，超过该体积只显示类型图标，避免列表页浪费带宽。 */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/** 预览需要把整份文件读进浏览器，超过该体积提示用户直接下载。 */
export const PREVIEW_MAX_BYTES = 50 * 1024 * 1024;

/** 浏览器普遍无法解码的图片格式，渲染出来只会是破图。 */
const UNRENDERABLE_IMAGE_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/x-tiff',
]);

export function getFilePreviewKind(mimeType: string): FilePreviewKind {
  const type = mimeType?.trim().toLowerCase() ?? '';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/') && !UNRENDERABLE_IMAGE_TYPES.has(type)) {
    return 'image';
  }
  return 'none';
}

/** 类型是否支持预览，不考虑体积。 */
export function isPreviewableType(mimeType: string): boolean {
  return getFilePreviewKind(mimeType) !== 'none';
}

/** 是否提供预览入口：类型支持且体积在上限内。 */
export function canPreviewFile(file: PreviewableFile): boolean {
  return (
    isPreviewableType(file.mimeType) && file.originalSize <= PREVIEW_MAX_BYTES
  );
}

/** 列表卡片是否渲染真实缩略图。 */
export function shouldRenderThumbnail(file: PreviewableFile): boolean {
  return (
    getFilePreviewKind(file.mimeType) === 'image' &&
    file.originalSize <= THUMBNAIL_MAX_BYTES
  );
}
