import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSceneSource() {
  return readFileSync(
    join(process.cwd(), 'src/components/effects/hero-workbench-scene.tsx'),
    'utf8'
  );
}

describe('hero workbench scene runtime guards', () => {
  it('keeps the decorative Three.js scene from crashing the page', () => {
    const source = readSceneSource();

    expect(source).toContain('try {');
    expect(source).toContain('catch (error)');
    expect(source).toContain("typeof ResizeObserver !== 'undefined'");
    expect(source).toContain("window.addEventListener('resize'");
  });

  it('pauses the RAF loop while the scene is outside the viewport', () => {
    const source = readSceneSource();

    expect(source).toContain('new IntersectionObserver(');
    expect(source).toContain('rootMargin');
    expect(source).toMatch(/let isInViewport =/);
    expect(source).toContain('isInViewport && document.visibilityState');
    expect(source).toContain('cancelAnimationFrame(animationFrame)');
    expect(source).toContain('clock.reset(performance.now())');
    expect(source).toContain('intersectionObserver?.disconnect()');
    expect(source).not.toContain(
      "if (document.visibilityState !== 'visible') {"
    );
  });

  it('runs the scene cleanup immediately when unmount beats the async start', () => {
    const source = readSceneSource();

    expect(source).toMatch(/start\(\)\.then\(cleanup => \{/);
    expect(source).toMatch(/if \(disposed\) \{\s*cleanup\(\);/);
  });
});
