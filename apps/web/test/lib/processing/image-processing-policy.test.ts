import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('image processing policy', () => {
  it('exports the 5 MiB local-processing threshold', async () => {
    const { LOCAL_PROCESSING_MAX_BYTES } =
      await import('@/lib/processing/image-processing-policy');

    expect(LOCAL_PROCESSING_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('treats files below 5 MiB as local candidates', async () => {
    const { shouldProcessLocally } =
      await import('@/lib/processing/image-processing-policy');

    expect(shouldProcessLocally({ size: 5 * 1024 * 1024 - 1 })).toBe(true);
    expect(shouldProcessLocally({ size: 0 })).toBe(true);
  });

  it('keeps exactly 5 MiB and larger on the server path', async () => {
    const { shouldProcessLocally } =
      await import('@/lib/processing/image-processing-policy');

    expect(shouldProcessLocally({ size: 5 * 1024 * 1024 })).toBe(false);
    expect(shouldProcessLocally({ size: 5 * 1024 * 1024 + 1 })).toBe(false);
  });
});

describe('image-client lazy compression import', () => {
  const source = readSource('src/lib/processing/image-client.ts');

  it('does not statically import browser-image-compression', () => {
    expect(source).not.toMatch(
      /import\s+imageCompression\s+from\s+['"]browser-image-compression['"]/
    );
  });

  it('loads browser-image-compression inside compressImage', () => {
    expect(source).toMatch(
      /await import\(\s*['"]browser-image-compression['"]\s*\)/
    );
  });

  it('re-exports the lightweight policy for existing callers', () => {
    expect(source).toContain("from './image-processing-policy'");
    expect(source).toContain('shouldProcessLocally');
  });
});

describe('image pages import the lightweight policy', () => {
  it.each([
    'src/app/[locale]/(app)/image/compress/page.tsx',
    'src/app/[locale]/(app)/image/convert/page.tsx',
    'src/app/[locale]/(app)/image/watermark/page.tsx',
  ])('%s uses image-processing-policy', path => {
    const source = readSource(path);

    expect(source).toContain('@/lib/processing/image-processing-policy');
    expect(source).not.toMatch(
      /import\s*{[^}]*shouldProcessLocally[^}]*}\s*from\s*['"]@\/lib\/processing\/image-client['"]/
    );
  });

  it('keeps compressImage on the image-client import for the compress page', () => {
    const source = readSource('src/app/[locale]/(app)/image/compress/page.tsx');

    expect(source).toContain('compressImage');
    expect(source).toContain('@/lib/processing/image-client');
  });
});
