import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTaskOutput, useTaskOutputPreviews } from '../use-task-output';

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

describe('useTaskOutputPreviews', () => {
  it('keeps pending true until every completed task has its blob url', async () => {
    const gates: Array<() => void> = [];
    globalThis.fetch = vi.fn(async () => {
      await new Promise<void>(resolve => gates.push(resolve));
      return okResponse();
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutputPreviews());

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.load('task-1', 'file-1');
      second = result.current.load('task-2', 'file-2');
    });

    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      gates[0]?.();
      await first;
    });
    // 一张到手、另一张还在路上：pending 仍然为 true。
    expect(result.current.previews['task-1']?.state).toBe('ready');
    expect(result.current.pending).toBe(true);

    await act(async () => {
      gates[1]?.();
      await second;
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.previews['task-2']?.url).toBeDefined();
  });

  it('marks a failed download as error and stops being pending', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutputPreviews());
    await act(async () => {
      await result.current.load('task-1', 'file-1');
    });

    expect(result.current.previews['task-1']).toEqual({ state: 'error' });
    expect(result.current.pending).toBe(false);
  });

  it('marks a missing output file id as error without fetching', async () => {
    const fetchImpl = vi.fn();
    globalThis.fetch = fetchImpl as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutputPreviews());
    await act(async () => {
      await result.current.load('task-1', '');
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.previews['task-1']).toEqual({ state: 'error' });
  });

  it('revokes urls on reset but not while other previews arrive', async () => {
    globalThis.fetch = vi.fn(async () =>
      okResponse()
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useTaskOutputPreviews());
    await act(async () => {
      await result.current.load('task-1', 'file-1');
    });
    await act(async () => {
      await result.current.load('task-2', 'file-2');
    });

    // 第二张到手不能连带 revoke 第一张 —— 那会让已展示图片的下载链接失效。
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    const urls = [
      result.current.previews['task-1']?.url,
      result.current.previews['task-2']?.url,
    ];

    act(() => result.current.reset());

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.flat()).toEqual(urls);
    expect(result.current.previews).toEqual({});
  });
});
