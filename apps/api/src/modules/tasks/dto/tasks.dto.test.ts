import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASK_TYPES } from '@utils-plane/validators';

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
});
