import sharp from 'sharp';

/**
 * 列表缩略图。
 *
 * 之前网格里直接内联原图,靠「小于 2 MB 才渲染」控制带宽,于是 AI 生图产物
 * (1024×1024 PNG 普遍 2.5–4 MB)一律退化成类型图标,只有点开预览才看得到图。
 * 这里由服务端统一缩到一条短边,列表就能既显示真图又不用拉原图。
 */

/** 缩略图长边像素。网格卡片高 96px,2x 屏下 320 足够,再大只是浪费带宽。 */
export const THUMBNAIL_MAX_EDGE = 320;

/** 超过这个体积的原图不做缩略:解码内存代价太高,前端退回类型图标。 */
export const THUMBNAIL_SOURCE_MAX_BYTES = 32 * 1024 * 1024;

export const THUMBNAIL_CONTENT_TYPE = 'image/webp';

/**
 * 支持缩略的原图类型。
 *
 * 与浏览器能内联渲染的集合保持一致:让网格能显示缩略、预览却打不开的类型出现在这里,
 * 只会造成「小图看得见、点开是空白」的错觉。svg 不进来(交给 librsvg 光栅化不值当)。
 */
const THUMBNAILABLE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
]);

export function isThumbnailableMimeType(mimeType: string): boolean {
  return THUMBNAILABLE_MIME_TYPES.has(mimeType?.trim().toLowerCase() ?? '');
}

export function canThumbnailFile(file: {
  mimeType: string;
  originalSize: number;
}): boolean {
  return (
    isThumbnailableMimeType(file.mimeType) &&
    file.originalSize <= THUMBNAIL_SOURCE_MAX_BYTES
  );
}

/**
 * 缩略图渲染。
 *
 * `rotate()` 按 EXIF 方向摆正;sharp 默认不透传元数据,所以缩略图里不会带原图的 GPS。
 * `failOn: 'none'` 让轻微损坏的图也能出图,而不是整格变成图标。
 */
export async function renderThumbnail(
  source: Buffer,
  maxEdge: number = THUMBNAIL_MAX_EDGE
): Promise<Buffer> {
  return sharp(source, { failOn: 'none' })
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();
}
