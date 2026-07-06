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
