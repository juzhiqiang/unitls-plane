export type TaskTypeValue =
  | 'compress'
  | 'convert'
  | 'image_watermark'
  | 'image_id_photo'
  | 'pdf_merge'
  | 'pdf_split'
  | 'pdf_to_image'
  | 'font_convert'
  | 'pdf_to_text'
  | 'image_to_pdf'
  | 'pdf_rotate'
  | 'pdf_watermark'
  | 'pdf_encrypt'
  | 'pdf_compress'
  | 'pdf_metadata'
  | 'pdf_rearrange'
  | 'pdf_from_document'
  | 'image_generate';

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

export interface ImageGenerateProviderDto {
  id: string;
  label: string;
  capabilities: Array<'generate' | 'edit'>;
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
