import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRenderOffscreen, createSurface } from '../canvas-surface';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createSurface on the main thread', () => {
  it('sizes the canvas and exports through toBlob', async () => {
    const toBlob = vi.fn((cb: (b: Blob | null) => void) =>
      cb(new Blob(['x'], { type: 'image/webp' }))
    );
    const canvas = { width: 0, height: 0, getContext: () => ({}), toBlob };
    vi.spyOn(document, 'createElement').mockReturnValue(
      canvas as unknown as HTMLElement
    );

    const surface = createSurface(120, 80);
    expect(canvas.width).toBe(120);
    expect(canvas.height).toBe(80);
    expect(surface.width).toBe(120);

    await expect(surface.toBlob('image/webp', 0.8)).resolves.toBeInstanceOf(
      Blob
    );
  });

  it('rounds and floors the size to at least one pixel', () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toBlob: () => {},
    };
    vi.spyOn(document, 'createElement').mockReturnValue(
      canvas as unknown as HTMLElement
    );

    createSurface(0.2, -5);
    expect(canvas.width).toBeGreaterThanOrEqual(1);
    expect(canvas.height).toBeGreaterThanOrEqual(1);
  });

  it('rejects when the browser cannot produce a blob', async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(
      canvas as unknown as HTMLElement
    );

    await expect(createSurface(10, 10).toBlob('image/png')).rejects.toThrow(
      'Canvas export failed'
    );
  });

  it('throws when a 2D context is unavailable', () => {
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLElement);

    expect(() => createSurface(10, 10)).toThrow('Canvas is not available');
  });
});

describe('canRenderOffscreen', () => {
  it('requires both Worker and OffscreenCanvas', () => {
    vi.stubGlobal('Worker', function Worker() {});
    vi.stubGlobal('OffscreenCanvas', function OffscreenCanvas() {});
    expect(canRenderOffscreen()).toBe(true);

    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(canRenderOffscreen()).toBe(false);

    vi.stubGlobal('OffscreenCanvas', function OffscreenCanvas() {});
    vi.stubGlobal('Worker', undefined);
    expect(canRenderOffscreen()).toBe(false);
  });
});
