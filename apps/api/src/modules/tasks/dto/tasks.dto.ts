import {
  taskStatusEnum,
  taskCategoryEnum,
  taskTypeEnum,
  TASK_CATEGORIES,
  TASK_TYPES,
  TASK_STATUSES,
} from '@utils-plane/validators';
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
  IsString,
  MaxLength,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';

export const taskQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: taskStatusEnum.optional(),
  category: taskCategoryEnum.optional(),
  type: taskTypeEnum.optional(),
});

export type TaskQueryInput = z.infer<typeof taskQuerySchema>;

type TaskTypeValue = (typeof TASK_TYPES)[number];
type TaskCategoryValue = (typeof TASK_CATEGORIES)[number];
type TaskStatusValue = (typeof TASK_STATUSES)[number];

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
  @ApiPropertyOptional({
    default: true,
    description: 'Cursor 模式是否返回 total；旧分页默认 true',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  includeTotal?: boolean = true;

  @ApiPropertyOptional({
    description:
      'Stable cursor from nextCursor; empty string starts cursor pagination',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

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
    enum: TASK_STATUSES,
  })
  @IsOptional()
  @IsEnum(TASK_STATUSES)
  status?: TaskStatusValue;

  @ApiPropertyOptional({ enum: TASK_CATEGORIES })
  @IsOptional()
  @IsEnum(TASK_CATEGORIES)
  category?: TaskCategoryValue;

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
    enum: TASK_STATUSES,
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
    enum: TASK_STATUSES,
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

export class BatchTaskStatusDto extends TaskStatusDto {
  @ApiProperty({ type: String, format: 'uuid' })
  taskId!: string;

  @ApiProperty({ type: String, enum: [...TASK_STATUSES, 'not_found'] })
  declare status: string;
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

  @ApiProperty({
    description:
      '该来源支持的尺寸（"auto" 或 "WxH"）。前端据此派生画面比例档位，创建任务时把选中的原始尺寸串放进 inputConfig.size',
    type: [String],
    isArray: true,
  })
  sizes!: string[];
}

export class ImageGenerateSessionDto {
  @ApiProperty({
    description:
      '会话 id（客户端生成 uuid，创建任务时放进 inputConfig.sessionId）',
    type: String,
    format: 'uuid',
  })
  sessionId!: string;

  @ApiProperty({
    description: '会话标题：该会话第一条任务的提示词前 20 个字符',
  })
  title!: string;

  @ApiProperty({
    description: '会话内生图任务总数',
  })
  taskCount!: number;

  @ApiProperty({
    description: '会话创建时间（首条任务时间，ISO 8601 UTC）',
    type: String,
  })
  createdAt!: string;

  @ApiProperty({
    description: '会话最近活动时间（末条任务时间，ISO 8601 UTC）',
    type: String,
  })
  updatedAt!: string;
}

export class ImageGenerateSessionTasksDto {
  @ApiProperty({
    description: '会话内任务，按创建时间正序排列（消息流数据源）',
    type: [TaskResponseDto],
    isArray: true,
  })
  tasks!: TaskResponseDto[];

  @ApiProperty({
    description: '会话内任务总数（返回条数上限 200）',
  })
  total!: number;
}

export class ImageGeneratePresetDto {
  @ApiProperty({
    description: '模板 id（uuid）',
  })
  id!: string;

  @ApiProperty({
    description: '当前语言（由 lang 查询参数决定）的模板标题',
  })
  title!: string;

  @ApiProperty({
    description: '当前语言（由 lang 查询参数决定）的提示词模板正文',
  })
  prompt!: string;

  @ApiPropertyOptional({
    description:
      '示例图在 MinIO presets 桶内的对象 key；前端用 NEXT_PUBLIC_S3_PUBLIC_URL 自行拼公网 URL',
  })
  imageStorageKey?: string;

  @ApiProperty({
    description: '排序值，升序展示',
  })
  sortOrder!: number;
}
