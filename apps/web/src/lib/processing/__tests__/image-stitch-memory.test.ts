import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  draw: vi.fn(),
  encode: vi.fn(),
}));
vi.mock('../image-bitmap', () => ({ decodeImage: mocks.decode }));
vi.mock('../canvas-surface', () => ({
  createSurface: () => ({
    ctx: { drawImage: mocks.draw, fillRect: vi.fn() },
    toBlob: mocks.encode,
  }),
}));
import { renderStitch } from '../image-stitch-client';
const options = {
  width: 100,
  gap: 0,
  background: 'transparent',
  outputType: 'image/png' as const,
  quality: 1,
  filename: 'out',
};
const limits = { maxFiles: 40, maxFileSize: 100, maxCanvasPixels: 10_000_000 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.encode.mockResolvedValue(new Blob(['out']));
});
describe('stitch decoded memory', () => {
  it('decodes small images once and releases every bitmap', async () => {
    const close = vi.fn();
    mocks.decode.mockImplementation(async () => ({
      width: 100,
      height: 100,
      source: {},
      close,
    }));
    await renderStitch([new Blob(), new Blob()], options, limits);
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(mocks.draw).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('releases cached images after decode or layout failure', async () => {
    const close = vi.fn();
    mocks.decode
      .mockResolvedValueOnce({ width: 100, height: 100, source: {}, close })
      .mockRejectedValueOnce(new Error('broken'));
    await expect(
      renderStitch([new Blob(), new Blob()], options, limits)
    ).rejects.toThrow('broken');
    expect(close).toHaveBeenCalledTimes(1);
    mocks.decode.mockResolvedValue({
      width: 100,
      height: 100,
      source: {},
      close,
    });
    await expect(
      renderStitch([new Blob()], options, { ...limits, maxCanvasPixels: 1 })
    ).rejects.toThrow('Canvas is too large');
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('does not retain multiple oversized decoded images', async () => {
    let active = 0,
      peak = 0;
    mocks.decode.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      return { width: 10000, height: 10000, source: {}, close: () => active-- };
    });
    await renderStitch(
      Array.from({ length: 40 }, () => new Blob()),
      options,
      limits
    );
    expect(peak).toBe(1);
    expect(active).toBe(0);
  });
});
