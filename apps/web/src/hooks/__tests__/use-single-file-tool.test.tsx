import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveToolStage, useSingleFileTool } from '../use-single-file-tool';

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function makeFile(name = 'a.jpg') {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('resolveToolStage', () => {
  it('walks upload → configure → processing → result', () => {
    expect(
      resolveToolStage({ hasFile: false, processing: false, hasResult: false })
    ).toBe('upload');
    expect(
      resolveToolStage({ hasFile: true, processing: false, hasResult: false })
    ).toBe('configure');
    expect(
      resolveToolStage({ hasFile: true, processing: true, hasResult: false })
    ).toBe('processing');
    expect(
      resolveToolStage({ hasFile: true, processing: false, hasResult: true })
    ).toBe('result');
  });

  it('lets a finished result win over a still-running flag', () => {
    // 重新处理时旧结果还在,阶段应显示 result 而不是在两态间闪。
    expect(
      resolveToolStage({ hasFile: true, processing: true, hasResult: true })
    ).toBe('result');
  });
});

describe('useSingleFileTool', () => {
  it('starts empty at the upload stage', () => {
    const { result } = renderHook(() => useSingleFileTool<File>());
    expect(result.current.file).toBeNull();
    expect(result.current.stage).toBe('upload');
  });

  it('clears the previous round when a new file is selected', () => {
    const { result } = renderHook(() => useSingleFileTool<File>());

    act(() => {
      result.current.setNatural({ width: 10, height: 10 });
      result.current.setResult(makeFile('old.png'));
      result.current.setError('boom');
    });
    act(() => result.current.selectFile(makeFile('new.jpg')));

    // 换图后还留着上一张的尺寸或结果,是这类页面最常见的串味 bug。
    expect(result.current.natural).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.stage).toBe('configure');
  });

  it('stores the result produced by run', async () => {
    const { result } = renderHook(() => useSingleFileTool<File>());
    act(() => result.current.selectFile(makeFile()));

    const produced = makeFile('out.png');
    await act(async () => {
      await result.current.run(async () => produced);
    });

    expect(result.current.result).toBe(produced);
    expect(result.current.processing).toBe(false);
    expect(result.current.stage).toBe('result');
  });

  it('captures failures and always clears the processing flag', async () => {
    const { result } = renderHook(() => useSingleFileTool<File>());
    act(() => result.current.selectFile(makeFile()));

    await act(async () => {
      await result.current.run(async () => {
        throw new Error('render failed');
      });
    });

    expect(result.current.error).toBe('render failed');
    // finally 必须跑到,否则按钮会永久禁用。
    expect(result.current.processing).toBe(false);
    expect(result.current.stage).toBe('configure');
  });

  it('clears a stale error when a new run starts', async () => {
    const { result } = renderHook(() => useSingleFileTool<File>());
    act(() => result.current.selectFile(makeFile()));

    await act(async () => {
      await result.current.run(async () => {
        throw new Error('first');
      });
    });
    await act(async () => {
      await result.current.run(async () => makeFile('ok.png'));
    });

    expect(result.current.error).toBeNull();
  });

  it('reset returns to the upload stage', () => {
    const { result } = renderHook(() => useSingleFileTool<File>());
    act(() => result.current.selectFile(makeFile()));
    act(() => result.current.reset());

    expect(result.current.file).toBeNull();
    expect(result.current.stage).toBe('upload');
  });
});
