import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = () =>
  readFileSync(
    join(process.cwd(), 'src/app/[locale]/(app)/pdf/from-document/page.tsx'),
    'utf8'
  );

describe('document to PDF page actions', () => {
  it('offers local Markdown export separately from server conversion', () => {
    const source = pageSource();

    expect(source).toContain('printMarkdownPreviewPdf');
    expect(source).toContain("t('fromDocument.localExport')");
    expect(source).toContain("t('fromDocument.serverExport')");
  });

  it('keeps sign-in gating on the server conversion path only', () => {
    const source = pageSource();
    const localExportIndex = source.indexOf('const handleLocalExport');
    const serverExportIndex = source.indexOf('const handleConvert');

    expect(localExportIndex).toBeGreaterThanOrEqual(0);
    expect(serverExportIndex).toBeGreaterThan(localExportIndex);
    expect(source.slice(localExportIndex, serverExportIndex)).not.toContain(
      'router.push'
    );
    expect(source.slice(serverExportIndex)).toContain('router.push');
  });
});
