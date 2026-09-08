import type { ImageGenerateBackground, ImageGenerateQuality } from '@utils-plane/validators';
import { IMAGE_GENERATE_INPAINT_PROMPT_PREFIX } from '@utils-plane/validators';

/**
 * 对话式生图页的输入草稿。
 *
 * 不再有显式 mode 字段:附了参考图就是 image_to_image,没附就是 text_to_image,
 * 提交时按当时的参考图状态决定,避免「模式=文生图却带着 inputFileIds」这类
 * schema 必拒组合的出现土壤。
 */
export interface ImageGenerateChatDraft {
  prompt: string;
  /** 省略时服务端用配置里的第一个来源;单来源部署不展示模型行。 */
  providerId?: string;
  /** "auto" 或 "WxH",选项由当前来源的 sizes 派生。 */
  size: string;
  quality: ImageGenerateQuality;
  /** 省略 = 默认(不向上游发 background 字段)。 */
  background?: ImageGenerateBackground;
  count: number;
}

/** 一次提交(一条消息)。N 张图是 N 个任务,靠 clientGroupId 聚合。 */
export interface GenerationMessageGroup {
  clientGroupId: string;
  prompt: string;
  mode: 'text_to_image' | 'image_to_image' | 'inpaint';
  /**
   * 图生图/融合时的参考图 fileId 列表(已上传),消息里显示缩略图用;
   * inpaint 时是 [原图, 带红色标记的原图],第一个元素是编辑底图(对比弹窗的"前")。
   */
  referenceFileIds: string[];
  taskIds: string[];
  /** 乐观消息在服务端数据回来前没有任务详情,只有任务 id 占位。 */
  tasks?: GenerationMessageTask[];
}

/** 消息组里单个任务的展示视图。 */
export interface GenerationMessageTask {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  outputFileId?: string;
  errorCode?: string;
}

/**
 * 兼容别名:局部重绘红标记通道的固定提示词前缀已上收到 @utils-plane/validators
 * (前后端共享同一份措辞,回退通道由后端拼接;展示层用它剥离存量任务里的前缀)。
 */
export const INPAINT_PROMPT_PREFIX = IMAGE_GENERATE_INPAINT_PROMPT_PREFIX;

/** inpaint 消息展示时剥掉固定前缀,只给用户看自己输入的部分。 */
export function stripInpaintPromptPrefix(prompt: string, mode: string): string {
  if (mode !== 'inpaint') return prompt;
  return prompt.startsWith(INPAINT_PROMPT_PREFIX)
    ? prompt.slice(INPAINT_PROMPT_PREFIX.length)
    : prompt;
}

/** 由 size 串派生画面比例标签:"1024x1536" → "2:3";无法解析时回退原串。 */
export function sizeToRatioLabel(size: string): string {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return size;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  return `${width / divisor}:${height / divisor}`;
}

/**
 * 草稿尺寸对来源 sizes 的回退解析:来源列表里没有当前值(默认 "auto" 在多数
 * 网关上不存在)时回落到第一档。来源列表未知时保持原值,由服务端兜底校验。
 */
export function resolveDraftSize(
  size: string,
  providerSizes: string[] | undefined
): string {
  if (!providerSizes || providerSizes.length === 0) return size;
  return providerSizes.includes(size) ? size : (providerSizes[0] ?? size);
}
