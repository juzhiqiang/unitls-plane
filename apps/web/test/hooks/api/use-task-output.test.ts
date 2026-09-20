import { StrictMode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTaskOutput } from '@/hooks/api/use-task-output';

function okResponse(body = 'image-bytes') {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([body], { type: 'image/png' }),
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  let counter = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${(counter += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe('useTaskOutput', () => {
  it('goes idle → loading → ready and returns the transformed result', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    globalThis.fetch = vi.fn(async () => {
      await gate;
      return okResponse();
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutput<File>());
    expect(result.current.state).toBe('idle');

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.download(
        'file-1',
        blob => new File([blob], 'out.png', { type: blob.type })
      );
    });

    // 关键行为：下载期间 pending 必须为 true —— 页面靠它把按钮按住，
    // 不让忙碌态比结果先解除。
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      release?.();
      await pending;
    });

    expect(result.current.state).toBe('ready');
    expect(result.current.pending).toBe(false);
    expect(result.current.result?.name).toBe('out.png');
  });

  it('still lands the result under StrictMode double-mount', async () => {
    // App Router 默认开着 StrictMode(reactStrictMode 未显式配置时为 true),
    // 挂载 effect 会被跑两遍:mount → cleanup → mount。若 effect 只在 cleanup
    // 里把 mountedRef 置 false、不在挂载时置回 true,ref 就永久停在 false,
    // 之后 download 的 setState 全部被吞掉 —— 页面表现为任务跑到 100%、
    // 结果区却永远空着,连下载按钮都看不到。
    globalThis.fetch = vi.fn(async () =>
      okResponse()
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutput<File>(), {
      wrapper: StrictMode,
    });

    await act(async () => {
      await result.current.download(
        'file-1',
        blob => new File([blob], 'out.dxf', { type: blob.type })
      );
    });

    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.state).toBe('ready');
  });

  it('turns a non-ok response into an error state without rejecting', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutput<File>());

    let outcome: { result: File | null; error: Error | null } | undefined;
    await act(async () => {
      outcome = await result.current.download(
        'file-1',
        blob => new File([blob], 'out.png')
      );
    });

    expect(outcome?.result).toBeNull();
    expect(outcome?.error?.message).toBe('Download failed');
    // pending 必须落回 false，否则页面会永久卡在处理中。
    expect(result.current.state).toBe('error');
    expect(result.current.pending).toBe(false);
  });

  it('turns a thrown fetch into an error state without rejecting', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutput<File>());

    let outcome: { error: Error | null } | undefined;
    await act(async () => {
      outcome = await result.current.download(
        'file-1',
        blob => new File([blob], 'x')
      );
    });

    expect(outcome?.error?.message).toBe('network down');
    expect(result.current.pending).toBe(false);
  });

  it('reports a missing output file id as an error instead of fetching', async () => {
    const fetchImpl = vi.fn();
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutput<File>());
    await act(async () => {
      await result.current.download('', blob => new File([blob], 'x'));
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.state).toBe('error');
  });

  it('reset clears the result and state', async () => {
    globalThis.fetch = vi.fn(async () =>
      okResponse()
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutput<File>());
    await act(async () => {
      await result.current.download(
        'file-1',
        blob => new File([blob], 'out.png')
      );
    });
    expect(result.current.state).toBe('ready');

    act(() => result.current.reset());
    expect(result.current.state).toBe('idle');
    expect(result.current.result).toBeNull();
  });
});
