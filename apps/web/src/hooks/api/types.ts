import type { components } from '@utils-plane/api-client';
import type {
  ImageTryOnMode,
  ImageTryOnReferenceBinding,
  TaskType,
} from '@utils-plane/validators';

export type TaskTypeValue = TaskType;

export interface CreateTaskDto {
  type: TaskTypeValue;
  inputFileIds: string[];
  inputConfig?: Record<string, unknown>;
}

export interface TaskResponseDto {
  id: string;
  userId?: string;
  type: TaskTypeValue;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  inputFileIds: string[];
  inputConfig?: Record<string, unknown>;
  outputFileId?: string;
  progress: number;
  errorCode?: string;
  errorMessage?: string;
  /**
   * 服务端输出事实。生图任务记录实际来源与模型;PDF 转 CAD 任务是
   * PdfToCadConversionMeta(页数、实体数、OCR 数、单位、降级原因),用 validators 的 schema 解析。
   */
  outputMeta?: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
}

export interface TaskStatusDto {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  outputFileId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ImageGenerateModelDto {
  model: string;
  capabilities: Array<'generate' | 'edit' | 'inpaint'>;
  /** 该模型支持的尺寸("auto" 或 "WxH"),画面比例档位由它派生。 */
  sizes: string[];
  /** 是否接受档位之外的尺寸;为 true 时画面比例行显示可用的「自定义」入口。 */
  customSizes: boolean;
}

/** 生图会话(由 image_generate 任务按 sessionId 派生,非独立实体)。 */
export interface ImageGenerateSessionDto {
  sessionId: string;
  title: string;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * AI 生图提示词模板。服务端按 lang 查询参数取双语言列的一侧，
 * 返回单语言扁平对象，前端零字段切换。
 * imageStorageKey 是 MinIO presets 桶内的对象 key，用 presetImageUrl() 拼公网 URL。
 */
export interface ImageGeneratePresetDto {
  id: string;
  title: string;
  prompt: string;
  imageStorageKey?: string;
  sortOrder: number;
}

export type AiTryOnMode = ImageTryOnMode;
type ApiTryOnReference = components['schemas']['AiTryOnReferenceDto'];
export type AiTryOnReferenceKind = ApiTryOnReference['kind'];
export type AiTryOnReferenceBinding = ImageTryOnReferenceBinding;
export type AiTryOnReferenceRole = AiTryOnReferenceBinding['role'];

export interface AiTryOnTaskConfig {
  [key: string]: unknown;
  mode: AiTryOnMode;
  references: AiTryOnReferenceBinding[];
  promptAddition?: string;
  size?: string;
  quality?: 'auto' | 'standard' | 'high';
  model?: string;
}

/** 兼容旧响应的 UI 模型；必填字段类型跟随 OpenAPI。 */
export interface AiTryOnReferenceAssetDto extends Pick<
  ApiTryOnReference,
  'id' | 'kind' | 'title' | 'tags' | 'sourceUrl' | 'licenseName' | 'attribution'
> {
  description?: string | null;
  thumbnailUrl: string;
  licenseUrl?: string | null;
  sortOrder?: number;
}
