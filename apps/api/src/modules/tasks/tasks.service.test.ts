import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('TasksService queue routing', () => {
  it('routes image watermark tasks to the image queue', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.service.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("case 'image_watermark':");
    expect(source).toMatch(
      /case 'image_watermark':\n\s+return this\.imageQueue;/
    );
  });
});
