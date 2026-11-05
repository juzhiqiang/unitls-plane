import { describe, expect, it } from 'vitest';
import { createSplitOutputFile } from '../../../../../../src/app/[locale]/(app)/pdf/split/output-file';

describe('createSplitOutputFile', () => {
  it('keeps a single split result as a PDF file', async () => {
    const file = await createSplitOutputFile(
      new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
      'plan.pdf'
    );

    expect(file.name).toBe('split-plan.pdf');
    expect(file.type).toBe('application/pdf');
  });

  it('keeps a multi-part split result as a ZIP file', async () => {
    const zip = new Blob(['PK\x03\x04archive'], {
      type: 'application/zip',
    });
    const file = await createSplitOutputFile(zip, 'plan.pdf');

    expect(file.name).toBe('split-plan.zip');
    expect(file.type).toBe('application/zip');
  });

  it('recognizes a ZIP response even when its MIME type is missing', async () => {
    const zip = new Blob(['PK\x03\x04archive']);
    const file = await createSplitOutputFile(zip, 'plan.pdf');

    expect(file.name).toBe('split-plan.zip');
    expect(file.type).toBe('application/zip');
  });
});
