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
  | 'pdf_rearrange';

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
