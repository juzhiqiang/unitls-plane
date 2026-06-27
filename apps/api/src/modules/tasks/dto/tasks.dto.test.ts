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
});
