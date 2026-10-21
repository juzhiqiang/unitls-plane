import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { segmentMock, compositeCutoutMock } = vi.hoisted(() => ({
  segmentMock: vi.fn(),
  compositeCutoutMock: vi.fn(),
}));

vi.mock('@/lib/id-photo-local/segmentation', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/id-photo-local/segmentation')>();
  return {
    ...actual,
    segmentToCutout: (...args: unknown[]) => segmentMock(...args),
  };
});

vi.mock('@/lib/cutout/composite', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/cutout/composite')>();
  return {
    ...actual,
    compositeCutout: (...args: unknown[]) => compositeCutoutMock(...args),
  };
});

import { useLocalCutout } from '@/lib/cutout/use-local-cutout';

let cutout: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let source: { width: number; height: number; close: ReturnType<typeof vi.fn> };

const options = {
  background: { kind: 'transparent' as const },
  outputType: 'image/png' as const,
};
const makeFile = () => new File(['img'], 'a.png', { type: 'image/png' });

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  cutout = { width: 4000, height: 6000, close: vi.fn() };
  source = { width: 4000, height: 6000, close: vi.fn() };
  segmentMock.mockReset();
  segmentMock.mockImplementation(async () => ({ bitmap: cutout, source }));
  compositeCutoutMock.mockReset();
  compositeCutoutMock.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  delete (navigator as unknown as { gpu?: unknown }).gpu;
});

describe('useLocalCutout', () => {
  it('keeps the original resolution: no source long-edge cap is requested', async () => {
    const { result } = renderHook(() => useLocalCutout());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', options);
    });

    await waitFor(() => expect(result.current.status).toBe('done'));
    const segmentOptions = segmentMock.mock.calls[0]![3] as {
      maxSourceEdge?: number;
    };
    expect(segmentOptions.maxSourceEdge).toBeUndefined();
    expect(compositeCutoutMock.mock.calls[0]![0]).toBe(cutout);
  });

  it('closes both the cutout and the source bitmap after compositing', async () => {
    const { result } = renderHook(() => useLocalCutout());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', options);
    });

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(cutout.close).toHaveBeenCalled();
    expect(source.close).toHaveBeenCalled();
  });

  it('closes both bitmaps when the session goes stale after segmentation', async () => {
    let release: () => void = () => {};
    segmentMock.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve({ bitmap: cutout, source });
        })
    );
    const { result } = renderHook(() => useLocalCutout());
    await act(async () => {
      result.current.process(makeFile(), 'balanced', options);
      await Promise.resolve();
    });
    act(() => result.current.reset());
    await act(async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe('idle');
    expect(compositeCutoutMock).not.toHaveBeenCalled();
    expect(cutout.close).toHaveBeenCalled();
    expect(source.close).toHaveBeenCalled();
  });
});
