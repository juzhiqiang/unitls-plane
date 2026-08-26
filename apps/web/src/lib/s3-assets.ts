/**
 * MinIO 匿名只读桶的公网 URL 拼接。
 *
 * API 侧只下发对象 key（如 `mind-map.jpg`），公网 URL 由前端用
 * `NEXT_PUBLIC_S3_PUBLIC_URL` 拼出，避免给 API 侧新增一份公网 URL 配置
 * （与 id-photo 的 `modelsBaseUrl()` 同思路，独立成文件不耦合 id-photo 模块）。
 */

/** AI 生图提示词模板示例图所在的匿名只读桶。 */
const PRESETS_BUCKET = 'presets';

/**
 * 模板示例图的公网 URL；未配置 NEXT_PUBLIC_S3_PUBLIC_URL 或 key 为空时返回 null。
 *
 * 刻意不抛错：示例图只是锦上添花，缺图时弹窗仍要能展示文字模板。
 */
export function presetImageUrl(key?: string | null): string | null {
  if (!key) return null;
  const base = process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${PRESETS_BUCKET}/${key}`;
}
