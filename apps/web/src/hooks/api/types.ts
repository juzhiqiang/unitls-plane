export interface CreateTaskDto {
  type: 'compress' | 'convert' | 'pdf_merge' | 'pdf_split' | 'pdf_to_image' | 'font_convert';
  inputFileIds: string[];
  inputConfig?: Record<string, unknown>;
}

export interface TaskResponseDto {
  id: string;
  userId?: string;
  type: 'compress' | 'convert' | 'pdf_merge' | 'pdf_split' | 'pdf_to_image' | 'font_convert';
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