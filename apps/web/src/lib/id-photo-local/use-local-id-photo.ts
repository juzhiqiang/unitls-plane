import { useCallback, useEffect, useRef, useState } from 'react';
import {
  idPhotoPresetSpecs,
  type IdPhotoOutputType,
  type IdPhotoPreset,
} from '@utils-plane/validators';
import { compositeIdPhoto } from './composite';
import {
  ID_PHOTO_MODELS,
  modelsBaseUrl,
  ortWasmPath,
  RMBG_MODEL_ID,
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
  // pipeline 按「档位」缓存:同档复用,换档重建(transformers.js 自身也有模型缓存)。
  const pipelineRef = useRef<{
    tier: ModelTier;
    seg: (input: string | Blob) => Promise<unknown>;
  } | null>(null);

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
        // 懒加载 transformers.js:仅在用户点击处理时按需加载(代码分割,SSR 不评估该库)。
        const tf = await import('@huggingface/transformers');
        if (sid !== sessionIdRef.current) return;

        const webgpu = ep === 'webgpu';
        const effectiveTier = tierFor(webgpu, tier);
        const meta = ID_PHOTO_MODELS[effectiveTier];
        if (!meta) throw new Error(`unknown model tier: ${effectiveTier}`);

        // 资产全部自托管在 MinIO:关掉本地路径探测,把 remoteHost 指向自有对象存储,
        // 并显式设置 ort wasm 目录(否则 transformers.js 会去 jsDelivr 取,离线镜像里拿不到)。
        tf.env.allowLocalModels = false;
        tf.env.remoteHost = modelsBaseUrl();
        tf.env.remotePathTemplate = '{model}/';
        const ortWasm = tf.env.backends?.onnx?.wasm;
        if (ortWasm) ortWasm.wasmPaths = ortWasmPath();

        // 进度回调:transformers.js 发 {status,file,progress}(progress 为 0..100)。
        // 下载阶段映射 loading-model;推理无细粒度进度,进入 running 后置 0。
        const onProgress = (p: {
          status?: string;
          progress?: number;
          file?: string;
        }) => {
          if (sid !== sessionIdRef.current) return;
          if (p.status === 'progress' && typeof p.progress === 'number') {
            setProgress(Math.max(0, Math.min(1, p.progress / 100)));
            setStatus('loading-model');
          }
        };

        // 同档位复用已建好的 pipeline,避免每次重新拉模型
        let seg =
          pipelineRef.current?.tier === effectiveTier
            ? pipelineRef.current.seg
            : null;
        if (!seg) {
          seg = (await tf.pipeline('background-removal', RMBG_MODEL_ID, {
            dtype: meta.dtype,
            device: webgpu ? 'webgpu' : 'wasm',
            progress_callback: onProgress,
          })) as unknown as (input: string | Blob) => Promise<unknown>;
          if (sid !== sessionIdRef.current) return;
          pipelineRef.current = { tier: effectiveTier, seg };
        }

        setStatus('running');
        setProgress(0);
        const out = await seg(file);
        if (sid !== sessionIdRef.current) return;

        // pipeline 返回 RawImage(或其数组),toCanvas() 给出带 alpha 的抠图
        const raw = (Array.isArray(out) ? out[0] : out) as {
          toCanvas?: () => HTMLCanvasElement | OffscreenCanvas;
        };
        if (!raw?.toCanvas) throw new Error('unexpected pipeline output');
        const cutoutCanvas = raw.toCanvas();

        setStatus('compositing');
        // 抠图已是透明 RGBA;转成 ImageBitmap 供合成按原尺寸裁剪缩放。
        const cutoutBitmap = await createImageBitmap(
          cutoutCanvas as unknown as CanvasImageSource
        );
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
