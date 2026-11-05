import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = () =>
  readFileSync(
    join(process.cwd(), 'src/app/[locale]/(app)/pdf/split/page.tsx'),
    'utf8'
  );

describe('PDF split page output delivery', () => {
  it('streams the stored output instead of buffering it as a browser blob', () => {
    const source = pageSource();

    expect(source).not.toContain('useTaskOutput');
    expect(source).toContain('StoredFileDownloadButton');
  });
});
