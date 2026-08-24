import { taskStatusEnum } from '@utils-plane/validators';
import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsArray,
  IsUUID,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export const taskQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: taskStatusEnum.optional(),
});

export type TaskQueryInput = z.infer<typeof taskQuerySchema>;

const TASK_TYPES = [
  'compress',
  'convert',
  'image_watermark',
  'image_id_photo',
  'pdf_merge',
  'pdf_split',
  'pdf_to_image',
  'font_convert',
  'pdf_to_text',
  'image_to_pdf',
  'pdf_rotate',
  'pdf_watermark',
  'pdf_encrypt',
  'pdf_compress',
  'pdf_metadata',
  'pdf_rearrange',
  'pdf_from_document',
  'image_generate',
] as const;

type TaskTypeValue = (typeof TASK_TYPES)[number];

export class CreateTaskDto {
  @ApiProperty({
    enum: TASK_TYPES,
  })
  @IsEnum(TASK_TYPES)
  type!: TaskTypeValue;

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @IsUUID('4', { each: true })
  inputFileIds!: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  inputConfig?: Record<string, unknown>;
}

export class TaskQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: ['pending', 'processing', 'completed', 'failed'],
  })
  @IsOptional()
  @IsEnum(['pending', 'processing', 'completed', 'failed'])
  status?: 'pending' | 'processing' | 'completed' | 'failed';

  @ApiPropertyOptional({
    enum: TASK_TYPES,
  })
  @IsOptional()
  @IsEnum(TASK_TYPES)
  type?: TaskTypeValue;
}

export class TaskResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  userId?: string;

  @ApiProperty({
    type: String,
    enum: TASK_TYPES,
  })
  type!: string;

  @ApiProperty({
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
  })
  status!: string;

  @ApiProperty({ type: [String] })
  inputFileIds!: string[];

  @ApiPropertyOptional({ type: Object })
  inputConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  outputFileId?: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  progress!: number;

  @ApiPropertyOptional({ type: String })
  errorCode?: string;

  @ApiPropertyOptional({ type: String })
  errorMessage?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional()
  completedAt?: Date;
}

export class TaskStatusDto {
  @ApiProperty({
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
  })
  status!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  progress!: number;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  outputFileId?: string;

  @ApiPropertyOptional({ type: String })
  errorCode?: string;

  @ApiPropertyOptional({ type: String })
  errorMessage?: string;
}

export class ImageGenerateQuotaDto {
  @ApiProperty({
    description: '当日生图张数上限',
  })
  limit!: number;

  @ApiProperty({
    description: '今日已用张数（失败的生成不计数）',
  })
  used!: number;

  @ApiProperty({
    description: '今日剩余张数',
  })
  remaining!: number;
}

export class ImageGenerateProviderDto {
  @ApiProperty({
    description: '来源 id，创建任务时放进 inputConfig.providerId',
  })
  id!: string;

  @ApiProperty({
    description: '展示给用户的来源名称',
  })
  label!: string;

  @ApiProperty({
    description:
      '该来源支持的能力。generate = 文生图，edit = 图生图；缺少 edit 时前端禁用参考图上传',
    type: [String],
    enum: ['generate', 'edit'],
    isArray: true,
  })
  capabilities!: string[];
}
