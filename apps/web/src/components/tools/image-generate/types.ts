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
 * 自定义画面比例解析(前端设置面板的「自定义」chip)。
 *
 * 接受两种写法:
 * - `W:H`(比例,如 `21:9`):先按约分后的比例找模型档位(16:9 → 1536x864);
 *   没有等比档位时按比例合成尺寸 —— 长边 1536,短边取整到 16 的倍数(21:9 → 1536x656)。
 * - `WxH`(尺寸,如 `1920x824`):原样返回,由模型决定是否接受(声明 customSizes 时原样提交;
 *   否则提交前会被 resolveDraftSize 按比例最近邻映射回档位)。
 *
 * 解析失败返回 null,调用方据此提示且不修改草稿。
 *
 * 参数校验:比例两侧 1–4096(比例是相对值,`16:9` 的 9 不该按像素下限卡掉);
 * 尺寸两侧 16–4096 且至少一边 ≥ 64,避免出现 `1x1` 这种无意义请求。
 */
export function resolveCustomRatio(
  input: string,
  modelSizes: string[] | undefined
): string | null {
  const match = /^\s*(\d{1,4})\s*([:xX])\s*(\d{1,4})\s*$/.exec(input.trim());
  if (!match) return null;
  const first = Number(match[1]);
  const separator = match[2] ?? '';
  const second = Number(match[3]);

  if (separator === ':') {
    if (first < 1 || first > 4096 || second < 1 || second > 4096) return null;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(first, second) || 1;
    const label = `${first / divisor}:${second / divisor}`;

    // 等比档位:与 chip 上的标签完全一致即视为同一比例(不要求等像素)。
    const declared = (modelSizes ?? []).find(
      size => size !== 'auto' && sizeToRatioLabel(size) === label
    );
    if (declared) return declared;

    // 无等比档位:长边固定 1536,短边按比例缩放并取整到 16 的倍数。
    const longSide = 1536;
    const shortSide = Math.max(
      16,
      Math.round(
        (longSide * Math.min(first, second)) / Math.max(first, second) / 16
      ) * 16
    );
    return first >= second
      ? `${longSide}x${shortSide}`
      : `${shortSide}x${longSide}`;
  }

  if (
    first < 16 ||
    first > 4096 ||
    second < 16 ||
    second > 4096 ||
    (first < 64 && second < 64)
  ) {
    return null;
  }
  return `${first}x${second}`;
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
