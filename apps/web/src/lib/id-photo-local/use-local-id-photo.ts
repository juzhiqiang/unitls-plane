import { useCallback, useEffect, useRef, useState } from 'react';
import {
  idPhotoPresetSpecs,
  type IdPhotoCrop,
  type IdPhotoOutputType,
  type IdPhotoPreset,
} from '@utils-plane/validators';
import { compositeIdPhoto } from './composite';
import { type ModelTier } from './model-registry';
import {
  detectLocalEp,
  isStaleSegmentation,
  segmentToCutout,
  type LocalEp,
} from './segmentation';

export type { LocalEp };

// 在模块作用域取值:hook 内的 `process` 回调会遮蔽全局 process,不能在其中写 process.env。
const IS_DEV = process.env.NODE_ENV !== 'production';

export type LocalStage =
  | 'idle'
  | 'loading-model'
  | 'running'
  | 'compositing'
  | 'done'
  | 'error';

export interface UseLocalIdPhoto {
  status: LocalStage;
  /** 0..1,资产下载阶段(fetch:);compute: 阶段也回传 0/0.25/0.5/0.75/1。 */
  progress: number;
  ep: LocalEp | null;
  error: string | null;
  resultBlob: Blob | null;
  process: (
    file: File,
    tier: ModelTier,
    opts: {
      preset: IdPhotoPreset;
      backgroundColor: string;
      outputType: IdPhotoOutputType;
      /** 归一化裁剪参数;省略即居中不放大。 */
      crop?: IdPhotoCrop;
    }
  ) => Promise<void>;
  reset: () => void;
}

/**
 * 本地证件照抠图(BRIA RMBG-1.4,经 @huggingface/transformers 的 background-removal pipeline)。
 *
 * 资产自托管在 MinIO(见 model-registry),含模型本体与 ort wasm 运行时;
 * transformers.js 自身缓存已下载的模型权重(浏览器 Cache Storage),故重复处理不会重复下载。
 * 推理在主线程执行(WebGPU 下约 0.6s;CPU wasm 档用 fp16,可接受)。
 */
export function useLocalIdPhoto(): UseLocalIdPhoto {
  const [status, setStatus] = useState<LocalStage>('idle');
  const [progress, setProgress] = useState(0);
  const [ep, setEp] = useState<LocalEp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);

  // 处理重入守卫:整个 process 期间置位,防止并发推理(会重复加载模型)。
  const inFlightRef = useRef(false);
  // 递增会话 id,reset/新 process 时自增;进度回调和结果按 sid 丢弃过期消息。
  const sessionIdRef = useRef(0);

  const process = useCallback<UseLocalIdPhoto['process']>(
    async (file, tier, opts) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const sid = ++sessionIdRef.current;
      setStatus('loading-model');
      setProgress(0);
      setError(null);
      setResultBlob(null);
      const isStale = () => sid !== sessionIdRef.current;
      try {
        const cutoutBitmap = await segmentToCutout(file, tier, ep ?? 'wasm', {
          onDownloadProgress: ratio => {
            if (isStale()) return;
            setProgress(ratio);
            setStatus('loading-model');
          },
          isStale,
        });
        if (isStale()) return;

        setStatus('compositing');
        try {
          const spec = idPhotoPresetSpecs[opts.preset];
          if (!spec) throw new Error(`unknown preset: ${opts.preset}`);
          const blob = await compositeIdPhoto(
            cutoutBitmap,
            opts.backgroundColor,
            spec.widthPx,
            spec.heightPx,
            opts.outputType,
            opts.crop
          );
          if (isStale()) return;
          setResultBlob(blob);
          setStatus('done');
        } finally {
          cutoutBitmap.close?.();
        }
      } catch (err) {
        if (isStale() || isStaleSegmentation(err)) return;
        // UI 只展示「本地处理失败」这类兜底文案,真实错误(ort 后端/资产加载)必须能看到,
        // 否则排查只能靠猜。仅开发态打印,生产不噪音。
        if (IS_DEV) {
          // eslint-disable-next-line no-console
          console.error('[id-photo-local] process failed:', err);
        }
        setError((err as Error).message);
        setStatus('error');
      } finally {
        inFlightRef.current = false;
      }
    },
    [ep]
  );

  const reset = useCallback(() => {
    // 使在途 removeBackground/进度回调失效;ep 保留(WebGPU 探测结果不随 reset 失效)。
    sessionIdRef.current++;
    inFlightRef.current = false;
    setStatus('idle');
    setProgress(0);
    setError(null);
    setResultBlob(null);
  }, []);

  // unmount 时使在途回调失效(无需 terminate worker)。
  useEffect(
    () => () => {
      sessionIdRef.current++;
      inFlightRef.current = false;
    },
    []
  );

  // 挂载时探测 WebGPU,使高精度开关在首次处理前就可交互。
  useEffect(() => {
    let cancelled = false;
    detectLocalEp().then(detected => {
      if (!cancelled) setEp(detected);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, progress, ep, error, resultBlob, process, reset };
}
