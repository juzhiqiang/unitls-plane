import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('TasksService queue routing', () => {
  it('routes image processing tasks to the image queue', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.service.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("case 'image_watermark':");
    expect(source).toContain("case 'image_id_photo':");
    expect(source).toMatch(
      /case 'image_watermark':\n\s+case 'image_id_photo':\n\s+return this\.imageQueue;/
    );
  });

  it('routes document-to-PDF tasks to the PDF queue', () => {
    const source = readFileSync(
      join(import.meta.dir, 'tasks.service.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("case 'pdf_from_document':");
    expect(source).toMatch(
      /case 'pdf_rearrange':\n\s+case 'pdf_from_document':\n\s+return this\.pdfQueue;/
    );
  });
});
