import { useCallback, useRef, useState } from 'react';
import {
  idPhotoPresetSpecs,
  type IdPhotoOutputType,
  type IdPhotoPreset,
} from '@utils-plane/validators';
import { compositeIdPhoto } from './composite';
import {
  ID_PHOTO_MODELS,
  modelUrl,
  tierFor,
  type ModelTier,
} from './model-registry';
import type { SegmenterEp, SegmenterResponse } from './segmenter-protocol';

export type LocalStage =
  | 'idle'
  | 'loading-model'
  | 'running'
  | 'compositing'
  | 'done'
  | 'error';

export interface UseLocalIdPhoto {
  status: LocalStage;
  /** 0..1,模型下载阶段 */
  progress: number;
  ep: SegmenterEp | null;
  error: string | null;
  resultBlob: Blob | null;
  process: (
    file: File,
    tier: ModelTier,
    opts: {
      preset: IdPhotoPreset;
      backgroundColor: string;
      outputType: IdPhotoOutputType;
    },
  ) => Promise<void>;
  reset: () => void;
}

export function useLocalIdPhoto(): UseLocalIdPhoto {
  const [status, setStatus] = useState<LocalStage>('idle');
  const [progress, setProgress] = useState(0);
  const [ep, setEp] = useState<SegmenterEp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<{
    bitmap: ImageBitmap;
    srcW: number;
    srcH: number;
    backgroundColor: string;
    preset: IdPhotoPreset;
    outputType: IdPhotoOutputType;
  } | null>(null);

  const ensureWorker = useCallback((onMessage: (m: SegmenterResponse) => void) => {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL('./portrait-segmenter.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (e: MessageEvent<SegmenterResponse>) =>
        onMessage(e.data);
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  const postRunFromPending = useCallback(
    (worker: Worker) => {
      const p = pendingRef.current;
      if (!p) return;
      worker.postMessage({
        type: 'run',
        bitmap: p.bitmap,
        srcW: p.srcW,
        srcH: p.srcH,
      });
    },
    [],
  );

  const process = useCallback<UseLocalIdPhoto['process']>(
    async (file, tier, opts) => {
      setError(null);
      setResultBlob(null);
      try {
        const bitmap = await createImageBitmap(file);
        const srcW = bitmap.width;
        const srcH = bitmap.height;
        pendingRef.current = {
          bitmap,
          srcW,
          srcH,
          backgroundColor: opts.backgroundColor,
          preset: opts.preset,
          outputType: opts.outputType,
        };

        // ep 初始 null 视为 webgpu 不可用 → tierFor 锁 balanced
        const webgpu = ep === 'webgpu';
        const effectiveTier = tierFor(webgpu, tier);
        const meta = ID_PHOTO_MODELS[effectiveTier];
        if (!meta) throw new Error(`unknown model tier: ${effectiveTier}`);

        const worker = ensureWorker((msg) => {
          if (msg.type === 'progress') {
            setProgress(msg.ratio);
            // 模型下载阶段本就是 loading-model,无条件刷新避免闭包陈旧 status
            setStatus('loading-model');
          } else if (msg.type === 'ready') {
            setEp(msg.ep);
            readyRef.current = true;
            setStatus('running');
            postRunFromPending(worker);
          } else if (msg.type === 'result') {
            setStatus('compositing');
            void compositeAndFinish(msg.mask, msg.maskW, msg.maskH);
          } else if (msg.type === 'error') {
            setError(msg.message);
            setStatus('error');
          }
        });

        if (!readyRef.current) {
          setStatus('loading-model');
          worker.postMessage({ type: 'init', modelUrl: modelUrl(meta) });
        } else {
          setStatus('running');
          postRunFromPending(worker);
        }
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
      }

      async function compositeAndFinish(
        mask: Float32Array,
        maskW: number,
        maskH: number,
      ) {
        const p = pendingRef.current;
        if (!p) return;
        try {
          const spec = idPhotoPresetSpecs[p.preset];
          if (!spec) throw new Error(`unknown preset: ${p.preset}`);
          const blob = await compositeIdPhoto(
            p.bitmap,
            mask,
            maskW,
            maskH,
            p.backgroundColor,
            spec.widthPx,
            spec.heightPx,
            p.outputType,
          );
          setResultBlob(blob);
          setStatus('done');
        } catch (err) {
          setError((err as Error).message);
          setStatus('error');
        }
      }
    },
    [ensureWorker, ep, postRunFromPending],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setError(null);
    setResultBlob(null);
    pendingRef.current = null;
  }, []);

  return { status, progress, ep, error, resultBlob, process, reset };
}
