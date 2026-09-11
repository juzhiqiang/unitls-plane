import { describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASK_TYPES } from '@utils-plane/validators';

const noOpDecorator = () => () => undefined;
mock.module('@nestjs/swagger', () => ({
  ApiProperty: noOpDecorator,
  ApiPropertyOptional: noOpDecorator,
}));
mock.module('class-transformer', () => ({
  Transform: noOpDecorator,
  Type: noOpDecorator,
}));
mock.module('class-validator', () => ({
  IsArray: noOpDecorator,
  IsBoolean: noOpDecorator,
  IsEnum: noOpDecorator,
  IsNumber: noOpDecorator,
  IsOptional: noOpDecorator,
  IsString: noOpDecorator,
  IsUUID: noOpDecorator,
  Max: noOpDecorator,
  MaxLength: noOpDecorator,
  Min: noOpDecorator,
}));

const { taskQuerySchema } = await import('./tasks.dto');

describe('TaskQueryDto', () => {
  it('accepts numeric query params from HTTP query strings', async () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.dto.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("import { Type } from 'class-transformer'");
    expect(source).toContain(
      '@Type(() => Number)\n  @IsNumber()\n  @Min(1)\n  page?'
    );
    expect(source).toContain(
      '@Type(() => Number)\n  @IsNumber()\n  @Min(1)\n  @Max(100)\n  limit?'
    );
  });

  // 任务类型枚举现在收敛到 @utils-plane/validators 的 TASK_TYPES 单一来源，
  // 这里校验该来源仍覆盖 API 边界必须存在的任务类型。
  it('includes the image watermark task type in the API boundary', () => {
    expect(TASK_TYPES).toContain('image_watermark');
  });

  it('includes the document-to-PDF task type in the API boundary', () => {
    expect(TASK_TYPES).toContain('pdf_from_document');
  });

  it('includes the AI image generation task type in the API boundary', () => {
    expect(TASK_TYPES).toContain('image_generate');
  });

  it('accepts only the supported task categories in the zod query schema', () => {
    for (const category of ['image', 'pdf', 'font'] as const) {
      expect(
        taskQuerySchema.safeParse({ category, type: 'pdf_merge' }).success
      ).toBe(true);
    }

    expect(taskQuerySchema.safeParse({ category: 'video' }).success).toBe(
      false
    );
  });

  it('preserves the exact task type in the zod query schema', () => {
    expect(
      taskQuerySchema.parse({ category: 'pdf', type: 'pdf_merge' })
    ).toMatchObject({
      category: 'pdf',
      type: 'pdf_merge',
    });
  });

  it('declares category as a Swagger and class-validator enum query property', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.dto.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain(
      '@ApiPropertyOptional({ enum: TASK_CATEGORIES })\n  @IsOptional()\n  @IsEnum(TASK_CATEGORIES)\n  category?: TaskCategoryValue;'
    );
  });
});
