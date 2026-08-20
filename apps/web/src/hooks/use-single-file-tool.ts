'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ToolStage } from '@/components/tools/tool-step-rail';

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * 由「有没有文件 / 在不在处理 / 有没有结果」推出当前阶段。
 *
 * 纯函数,不依赖 React —— 九个图片页都在各自内联这段三元嵌套,但 processing 与
 * result 的来源各不相同(自有 state、useLocalCutout、任务轮询),所以只有这段判断
 * 能被全部复用。
 */
export function resolveToolStage(input: {
  hasFile: boolean;
  processing: boolean;
  hasResult: boolean;
}): ToolStage {
  if (input.hasResult) return 'result';
  if (input.processing) return 'processing';
  return input.hasFile ? 'configure' : 'upload';
}

export interface SingleFileTool<R> {
  file: File | null;
  natural: ImageSize | null;
  result: R | null;
  processing: boolean;
  error: string | null;
  stage: ToolStage;
  setNatural: (size: ImageSize) => void;
  setResult: (result: R | null) => void;
  setError: (message: string | null) => void;
  /** 选中新文件:同时清掉上一轮的尺寸、结果与错误。 */
  selectFile: (file: File | null) => void;
  /** 跑一次处理,统一 setProcessing / 清错误 / 捕获异常。 */
  run: (task: () => Promise<R>) => Promise<void>;
  reset: () => void;
}

/**
 * 单文件本地工具的状态机。
 *
 * 抽 hook 而不是抽组件:这些页面共享的是状态转换,而中间的选项 UI 差异极大,
 * 做成组件就要用一堆 slot props 把差异塞回去,比重复更难读。
 *
 * 也没有强行覆盖全部九个图片页 —— 多文件双模式的(压缩/转换/水印)与结果由别的
 * hook 持有的(抠图/证件照)形态不同,硬套同一个抽象只会走形,它们改用
 * resolveToolStage 复用那段判断即可。
 */
export function useSingleFileTool<R>(): SingleFileTool<R> {
  const [file, setFile] = useState<File | null>(null);
  const [natural, setNatural] = useState<ImageSize | null>(null);
  const [result, setResult] = useState<R | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectFile = useCallback((next: File | null) => {
    setFile(next);
    setNatural(null);
    setResult(null);
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setFile(null);
    setNatural(null);
    setResult(null);
    setError(null);
    setProcessing(false);
  }, []);

  const run = useCallback(async (task: () => Promise<R>) => {
    setProcessing(true);
    setError(null);
    try {
      setResult(await task());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProcessing(false);
    }
  }, []);

  const stage = useMemo(
    () =>
      resolveToolStage({
        hasFile: Boolean(file),
        processing,
        hasResult: result !== null,
      }),
    [file, processing, result]
  );

  return {
    file,
    natural,
    result,
    processing,
    error,
    stage,
    setNatural,
    setResult,
    setError,
    selectFile,
    run,
    reset,
  };
}
