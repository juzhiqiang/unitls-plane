import type {
  ImageGenerateBackground,
  ImageGenerateQuality,
} from '@utils-plane/validators';
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
  /** 省略时服务端用配置里第一个来源的第一个模型;单模型部署不展示模型行。 */
  model?: string;
  /** "auto" 或 "WxH",选项由当前模型的 sizes 派生。 */
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
  /**
   * 服务端已脱敏的真实失败原因(剥掉 prompt 回显与密钥)。
   * 没有专属文案的错误码直接展示它,让用户看到到底是超时、限流还是上游报错。
   */
  errorMessage?: string;
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
 * 草稿尺寸对模型 sizes 的回退解析:
 * 1. 列表里有完全匹配的值(含 "auto")时原样返回;
 * 2. 如果输入是 WxH 格式(例如编辑时根据原图物理分辨率传入,或上游返回的非标分辨率),
 *    按宽高比(aspect ratio)匹配列表中最接近的档位,避免非正方形图片(如 16:9 的 1792x1024)
 *    因字面量不匹配而被错误强转为 1:1 的 1024x1024;
 * 3. 都不匹配时回落到第一档。模型列表未知时保持原值,由服务端兜底校验。
 */
export function resolveDraftSize(
  size: string,
  modelSizes: string[] | undefined
): string {
  if (!modelSizes || modelSizes.length === 0) return size;
  if (modelSizes.includes(size)) return size;

  // 尝试宽高比最近邻匹配
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (match) {
    const targetWidth = Number(match[1]);
    const targetHeight = Number(match[2]);
    if (targetWidth > 0 && targetHeight > 0) {
      const targetRatio = targetWidth / targetHeight;
      let closestSize: string | null = null;
      let minDiff = Infinity;

      for (const candidate of modelSizes) {
        const candidateMatch = /^(\d+)x(\d+)$/.exec(candidate);
        if (!candidateMatch) continue;
        const cWidth = Number(candidateMatch[1]);
        const cHeight = Number(candidateMatch[2]);
        if (cWidth > 0 && cHeight > 0) {
          const candidateRatio = cWidth / cHeight;
          const diff = Math.abs(candidateRatio - targetRatio);
          if (diff < minDiff) {
            minDiff = diff;
            closestSize = candidate;
          }
        }
      }

      if (closestSize) {
        return closestSize;
      }
    }
  }

  return modelSizes[0] ?? size;
}
