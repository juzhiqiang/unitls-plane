import { createTaskSchema, taskStatusEnum } from '@utils-plane/validators';
import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateTaskDto {
  @ApiProperty({
    enum: ['compress', 'convert', 'pdf_merge', 'pdf_split', 'pdf_to_image', 'font_convert'],
  })
  @IsEnum(['compress', 'convert', 'pdf_merge', 'pdf_split', 'pdf_to_image', 'font_convert'])
  type!: 'compress' | 'convert' | 'pdf_merge' | 'pdf_split' | 'pdf_to_image' | 'font_convert';

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
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
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
    enum: ['compress', 'convert', 'pdf_merge', 'pdf_split', 'pdf_to_image', 'font_convert'],
  })
  @IsOptional()
  @IsEnum(['compress', 'convert', 'pdf_merge', 'pdf_split', 'pdf_to_image', 'font_convert'])
  type?: 'compress' | 'convert' | 'pdf_merge' | 'pdf_split' | 'pdf_to_image' | 'font_convert';
}

export class TaskResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  userId?: string;

  @ApiProperty({
    enum: ['compress', 'convert', 'pdf_merge', 'pdf_split', 'pdf_to_image', 'font_convert'],
  })
  type!: string;

  @ApiProperty({ enum: ['pending', 'processing', 'completed', 'failed'] })
  status!: string;

  @ApiProperty({ type: [String] })
  inputFileIds!: string[];

  @ApiPropertyOptional({ type: Object })
  inputConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ format: 'uuid' })
  outputFileId?: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  progress!: number;

  @ApiPropertyOptional()
  errorCode?: string;

  @ApiPropertyOptional()
  errorMessage?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional()
  completedAt?: Date;
}

export class TaskStatusDto {
  @ApiProperty({ enum: ['pending', 'processing', 'completed', 'failed'] })
  status!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  progress!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  outputFileId?: string;

  @ApiPropertyOptional()
  errorCode?: string;

  @ApiPropertyOptional()
  errorMessage?: string;
}
