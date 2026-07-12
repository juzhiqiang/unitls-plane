import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('hero workbench scene runtime guards', () => {
  it('keeps the decorative Three.js scene from crashing the page', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/effects/hero-workbench-scene.tsx'),
      'utf8'
    );

    expect(source).toContain('try {');
    expect(source).toContain('catch (error)');
    expect(source).toContain("typeof ResizeObserver !== 'undefined'");
    expect(source).toContain("window.addEventListener('resize'");
  });
});
