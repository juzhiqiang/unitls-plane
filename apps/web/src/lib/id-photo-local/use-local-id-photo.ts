import { useCallback, useEffect, useRef, useState } from 'react';
import {
  idPhotoPresetSpecs,
  type IdPhotoOutputType,
  type IdPhotoPreset,
} from '@utils-plane/validators';
import { compositeIdPhoto } from './composite';
import {
  ID_PHOTO_MODELS,
  imglyPublicPath,
  tierFor,
  type ModelTier,
} from './model-registry';

/** 本地执行后端(WebGPU 可用性),用于高精度开关门控与 device 选择。 */
export type LocalEp = 'webgpu' | 'wasm';

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
    }
  ) => Promise<void>;
  reset: () => void;
}

/**
 * 本地证件照抠图(@imgly/background-removal,ISNet)。
 *
 * 资产自托管在 MinIO(见 model-registry.imglyPublicPath),库运行时从该 publicPath
 * 拉分块 wasm + 模型;CORS 由 2025 版 MinIO 自动处理(回显 Origin + 暴露 Content-Length)。
 * 库内部缓存 ort session,同 model 复用,故无需手工管理 ready/loadedTier。
 * removeBackground 在主线程执行(WebGPU 推理为 GPU 占用,CPU 路径在均衡档可接受)。
 */
export function useLocalIdPhoto(): UseLocalIdPhoto {
  const [status, setStatus] = useState<LocalStage>('idle');
  const [progress, setProgress] = useState(0);
  const [ep, setEp] = useState<LocalEp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);

  // 处理重入守卫:整个 process 期间置位,防止并发 removeBackground(@imgly 会重复加载模型)。
  const inFlightRef = useRef(false);
  // 递增会话 id,reset/新 process 时自增;@imgly 进度回调和结果按 sid 丢弃过期消息。
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
      try {
        // 懒加载 @imgly:仅在用户点击处理时按需加载(代码分割,SSR 不评估该库)。
        const { removeBackground } = await import('@imgly/background-removal');
        if (sid !== sessionIdRef.current) return;

        const webgpu = ep === 'webgpu';
        const effectiveTier = tierFor(webgpu, tier);
        const meta = ID_PHOTO_MODELS[effectiveTier];
        if (!meta) throw new Error(`unknown model tier: ${effectiveTier}`);

        // 进度回调:@imgly 发 fetch:<key>(下载分块)与 compute:decode|inference|mask|encode
        // (current/total)。前者映射 loading-model + 下载进度,后者映射 running。
        const onProgress = (key: string, current: number, total: number) => {
          if (sid !== sessionIdRef.current) return;
          const ratio = total > 0 ? current / total : 0;
          if (key.startsWith('fetch:')) {
            setProgress(ratio);
            setStatus('loading-model');
          } else if (key.startsWith('compute:')) {
            setStatus('running');
            setProgress(ratio);
          }
        };

        const cutoutBlob = await removeBackground(file, {
          model: meta.model,
          device: webgpu ? 'gpu' : 'cpu',
          output: { format: 'image/png', quality: 0.9 },
          publicPath: imglyPublicPath(),
          progress: onProgress,
        });
        if (sid !== sessionIdRef.current) return;

        setStatus('compositing');
        // 抠图已是透明 RGBA;解码为 ImageBitmap 供合成按原尺寸裁剪缩放。
        const cutoutBitmap = await createImageBitmap(cutoutBlob);
        try {
          const spec = idPhotoPresetSpecs[opts.preset];
          if (!spec) throw new Error(`unknown preset: ${opts.preset}`);
          const blob = await compositeIdPhoto(
            cutoutBitmap,
            opts.backgroundColor,
            spec.widthPx,
            spec.heightPx,
            opts.outputType
          );
          if (sid !== sessionIdRef.current) return;
          setResultBlob(blob);
          setStatus('done');
        } finally {
          cutoutBitmap.close?.();
        }
      } catch (err) {
        if (sid !== sessionIdRef.current) return;
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
    const gpu =
      typeof navigator !== 'undefined'
        ? (
            navigator as unknown as {
              gpu?: { requestAdapter?: () => Promise<unknown> };
            }
          ).gpu
        : undefined;
    if (!gpu?.requestAdapter) {
      setEp('wasm');
      return;
    }
    gpu
      .requestAdapter()
      .then(adapter => {
        if (!cancelled) setEp(adapter ? 'webgpu' : 'wasm');
      })
      .catch(() => {
        if (!cancelled) setEp('wasm');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, progress, ep, error, resultBlob, process, reset };
}
