import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('includes the image watermark task type in the API boundary', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.dto.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("'image_watermark'");
  });

  it('includes the document-to-PDF task type in the API boundary', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.dto.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("'pdf_from_document'");
  });

  it('includes the AI image generation task type in the API boundary', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.dto.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("'image_generate'");
  });
});
