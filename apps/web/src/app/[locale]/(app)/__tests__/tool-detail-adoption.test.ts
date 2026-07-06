import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const detailPages = [
  ['/image/compress', 'src/app/[locale]/(app)/image/compress/page.tsx'],
  ['/image/convert', 'src/app/[locale]/(app)/image/convert/page.tsx'],
  ['/image/watermark', 'src/app/[locale]/(app)/image/watermark/page.tsx'],
  ['/font', 'src/app/[locale]/(app)/font/page.tsx'],
  ['/pdf/merge', 'src/app/[locale]/(app)/pdf/merge/page.tsx'],
  ['/pdf/split', 'src/app/[locale]/(app)/pdf/split/page.tsx'],
  ['/pdf/to-image', 'src/app/[locale]/(app)/pdf/to-image/page.tsx'],
  ['/pdf/to-text', 'src/app/[locale]/(app)/pdf/to-text/page.tsx'],
  ['/pdf/from-image', 'src/app/[locale]/(app)/pdf/from-image/page.tsx'],
  ['/pdf/rotate', 'src/app/[locale]/(app)/pdf/rotate/page.tsx'],
  ['/pdf/watermark', 'src/app/[locale]/(app)/pdf/watermark/page.tsx'],
  ['/pdf/encrypt', 'src/app/[locale]/(app)/pdf/encrypt/page.tsx'],
  ['/pdf/compress', 'src/app/[locale]/(app)/pdf/compress/page.tsx'],
  ['/pdf/metadata', 'src/app/[locale]/(app)/pdf/metadata/page.tsx'],
  ['/pdf/rearrange', 'src/app/[locale]/(app)/pdf/rearrange/page.tsx'],
] as const;

describe('tool detail shell adoption', () => {
  it.each(detailPages)(
    'wraps %s with the shared tool detail experience',
    (href, filePath) => {
      const source = readFileSync(join(process.cwd(), filePath), 'utf8');

      expect(source).toContain('ToolPageShell');
      expect(source).toContain('FailureRecoveryPanel');
      expect(source).toContain('ResultPanel');
      expect(source).toContain(`getToolByHref('${href}')`);
    }
  );
});
