'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 任务产物的取回状态。
 *
 * 任务状态变成 completed 只代表服务端产物已就绪,页面要展示的东西还得再花一次
 * `GET /files/{id}/download` 才拿到手。这两件事以前在每个工具页各写一遍,写法不齐:
 * 大多数页面靠 try/finally 把「处理中」按住到下载结束,image/id-photo 漏了 catch
 * (下载一失败就永久卡在处理中),image/generate 则相反 —— 按状态轮询一 settled 就
 * 解除忙碌态,于是按钮先恢复、结果区空着、图片随后突然出现。
 *
 * 这个模块把「产物取回」收成一个显式状态机,页面只需要读 pending / state。
 */
export type TaskOutputState = 'idle' | 'loading' | 'ready' | 'error';

/** blob → 页面要用的结果对象。命名、后缀、二次解析都留在调用处。 */
export type TaskOutputTransform<T> = (blob: Blob) => T | Promise<T>;

/**
 * download 的返回值。
 *
 * 刻意把结果与错误一起回传,而不是让调用方 await 完再去读 hook 的 error state ——
 * setState 还没 flush,那样读到的是上一轮的值。
 */
export interface TaskOutputDownloadResult<T> {
  result: T | null;
  error: Error | null;
}

export interface UseTaskOutputResult<T> {
  state: TaskOutputState;
  /** 产物正在取回。页面据此把按钮按住,别让它比结果先恢复。 */
  pending: boolean;
  result: T | null;
  error: Error | null;
  /** 取回产物。永不 reject —— 失败落在返回值与 error state 里。 */
  download: (
    outputFileId: string,
    transform: TaskOutputTransform<T>
  ) => Promise<TaskOutputDownloadResult<T>>;
  setResult: (value: T | null) => void;
  reset: () => void;
}

function downloadUrl(outputFileId: string): string {
  return `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`;
}

/**
 * 单任务产物取回。绝大多数工具页是「一个任务一个产物」,用这个。
 *
 * 典型接法:
 *
 * ```ts
 * const output = useTaskOutput<File>();
 * useTaskProgress(taskId, {
 *   onCompleted: async outputFileId => {
 *     const { error } = await output.download(
 *       outputFileId,
 *       blob => new File([blob], name, { type: blob.type })
 *     );
 *     if (error) setError(error.message);
 *     setProcessing(false);
 *   },
 * });
 * ```
 */
export function useTaskOutput<T>(): UseTaskOutputResult<T> {
  const [state, setState] = useState<TaskOutputState>('idle');
  const [result, setResultState] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // 卸载后不再 setState:下载可能比页面活得久。
  //
  // 挂载时**必须**重新置 true。App Router 默认开着 StrictMode(未显式配置
  // reactStrictMode 时为 true),挂载 effect 会走一遍 mount → cleanup → mount;
  // 只在 cleanup 里置 false 的话,ref 就永久停在 false,之后 download 的每个
  // setState 都被吞掉 —— 任务跑到 100%、结果区却一直空着,连下载按钮都不出现。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const download = useCallback(
    async (
      outputFileId: string,
      transform: TaskOutputTransform<T>
    ): Promise<TaskOutputDownloadResult<T>> => {
      if (!outputFileId) {
        const missing = new Error('Missing output file');
        if (mountedRef.current) {
          setState('error');
          setError(missing);
        }
        return { result: null, error: missing };
      }

      if (mountedRef.current) {
        setState('loading');
        setError(null);
      }

      try {
        const response = await fetch(downloadUrl(outputFileId), {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Download failed');
        const value = await transform(await response.blob());
        if (mountedRef.current) {
          setResultState(value);
          setState('ready');
        }
        return { result: value, error: null };
      } catch (caught) {
        const failure =
          caught instanceof Error ? caught : new Error('Download failed');
        if (mountedRef.current) {
          setState('error');
          setError(failure);
        }
        return { result: null, error: failure };
      }
    },
    []
  );

  const setResult = useCallback((value: T | null) => {
    setResultState(value);
    setState(value === null ? 'idle' : 'ready');
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setResultState(null);
    setState('idle');
    setError(null);
  }, []);

  return {
    state,
    pending: state === 'loading',
    result,
    error,
    download,
    setResult,
    reset,
  };
}

