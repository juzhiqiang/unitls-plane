import { useCallback, useEffect, useRef, useState } from 'react';
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
  // 始终指向"最新一次 process 注册的消息处理器",供 worker.onmessage 转发。
  // 这样每次 process 都能携带自己的 sessionId 闭包,旧回包自然被丢弃(MEDIUM 7)。
  const handlerRef = useRef<((m: SegmenterResponse) => void) | null>(null);
  const readyRef = useRef(false);
  // 记录当前 worker 已加载的 tier,用于判定是否需要重载模型(CRITICAL 2)。
  const loadedTierRef = useRef<ModelTier | null>(null);
  // 处理重入守卫:createImageBitmap 期间不允许并发触发第二次 process(MEDIUM 10)。
  const inFlightRef = useRef(false);
  // 递增会话 id,reset / 新 process 时自增;worker 回包按 sid 丢弃过期消息(MEDIUM 7)。
  const sessionIdRef = useRef(0);
  const pendingRef = useRef<{
    bitmap: ImageBitmap;
    srcW: number;
    srcH: number;
    backgroundColor: string;
    preset: IdPhotoPreset;
    outputType: IdPhotoOutputType;
  } | null>(null);

  // 关闭并清空 pending bitmap,避免 ImageBitmap 泄漏(MEDIUM 9)。
  const clearPending = useCallback(() => {
    const p = pendingRef.current;
    if (p?.bitmap && typeof p.bitmap.close === 'function') {
      try {
        p.bitmap.close();
      } catch {
        /* 已 detached 的 bitmap close 可能抛,忽略 */
      }
    }
    pendingRef.current = null;
  }, []);

  // 创建 Worker(仅一次);onmessage 转发到 handlerRef.current,使每次 process
  // 都能注入带自身 sessionId 的处理器。返回已存在的 worker。
  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(
        new URL('./portrait-segmenter.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (e: MessageEvent<SegmenterResponse>) => {
        handlerRef.current?.(e.data);
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  const postRunFromPending = useCallback((worker: Worker) => {
    const p = pendingRef.current;
    if (!p) return;
    worker.postMessage({
      type: 'run',
      bitmap: p.bitmap,
      srcW: p.srcW,
      srcH: p.srcH,
    });
  }, []);

  const process = useCallback<UseLocalIdPhoto['process']>(
    async (file, tier, opts) => {
      // 重入守卫:createImageBitmap 期间未置处理态,双击会并发;入口直接拒绝(MEDIUM 10)
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      // 立即反馈处理态,避免 await bitmap 期间 UI 无变化(MEDIUM 10)
      setStatus('loading-model');
      setError(null);
      setResultBlob(null);
      const sid = ++sessionIdRef.current;
      try {
        const bitmap = await createImageBitmap(file);
        // await 期间若 reset / 新 process 使 sid 失效,丢弃本次结果
        if (sid !== sessionIdRef.current) {
          if (typeof bitmap.close === 'function') {
            try {
              bitmap.close();
            } catch {
              /* ignore */
            }
          }
          return;
        }
        // 覆盖旧 pending 前先释放旧 bitmap(MEDIUM 9)
        clearPending();
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

        // ep 初始 null 视为 webgpu 不可用 → tierFor 锁 balanced;
        // ready 后 ep 已知,据此计算实际应使用的 tier。
        const webgpu = ep === 'webgpu';
        const effectiveTier = tierFor(webgpu, tier);
        const meta = ID_PHOTO_MODELS[effectiveTier];
        if (!meta) throw new Error(`unknown model tier: ${effectiveTier}`);

        // 注入本次会话的处理器:所有 worker 回包按 sid 校验,过期即丢弃(MEDIUM 7)。
        const worker = ensureWorker();
        handlerRef.current = (msg) => {
          if (sid !== sessionIdRef.current) return;
          if (msg.type === 'progress') {
            setProgress(msg.ratio);
            // 模型下载阶段本就是 loading-model,无条件刷新避免闭包陈旧 status
            setStatus('loading-model');
          } else if (msg.type === 'ready') {
            setEp(msg.ep);
            readyRef.current = true;
            // loadedTierRef 已在发 init 时设置
            setStatus('running');
            postRunFromPending(worker);
          } else if (msg.type === 'result') {
            setStatus('compositing');
            void compositeAndFinish(sid, msg.mask, msg.maskW, msg.maskH);
          } else if (msg.type === 'error') {
            setError(msg.message);
            setStatus('error');
          }
        };

        // CRITICAL 2:未 ready,或已加载 tier 与目标 tier 不一致 → 重新 init 加载新模型;
        // 否则复用 session 直接 run。
        if (!readyRef.current || effectiveTier !== loadedTierRef.current) {
          loadedTierRef.current = effectiveTier;
          setStatus('loading-model');
          worker.postMessage({ type: 'init', modelUrl: modelUrl(meta) });
        } else {
          setStatus('running');
          postRunFromPending(worker);
        }
      } catch (err) {
        setError((err as Error).message);
        setStatus('error');
      } finally {
        // 守卫仅覆盖到入口并发;处理态转换至 done/error 由 worker 回包驱动,
        // 故此处释放守卫,使 done/error 后可再次发起 process。
        inFlightRef.current = false;
      }

      async function compositeAndFinish(
        maskSid: number,
        mask: Float32Array,
        maskW: number,
        maskH: number,
      ) {
        if (maskSid !== sessionIdRef.current) return;
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
          // 合成期间若已失效(用户 reset / 切换),不落结果
          if (maskSid !== sessionIdRef.current) return;
          setResultBlob(blob);
          setStatus('done');
        } catch (err) {
          if (maskSid !== sessionIdRef.current) return;
          setError((err as Error).message);
          setStatus('error');
        } finally {
          // 合成完成(成功/失败)后释放 bitmap(MEDIUM 9)
          clearPending();
        }
      }
    },
    [clearPending, ensureWorker, ep, postRunFromPending],
  );

  const reset = useCallback(() => {
    // 使在途 worker 回包失效(MEDIUM 7),清 ready/loadedTier 使下次必走 init(MEDIUM 6 / CRITICAL 2)
    sessionIdRef.current++;
    readyRef.current = false;
    loadedTierRef.current = null;
    inFlightRef.current = false;
    setEp(null);
    setStatus('idle');
    setProgress(0);
    setError(null);
    setResultBlob(null);
    clearPending();
  }, [clearPending]);

  // HIGH 3:unmount 时 terminate worker 并清状态;reset 不 terminate(可复用 worker)。
  // clearPending 稳定(useCallback []),effect 只在挂载/卸载时各跑一次。
  useEffect(
    () => () => {
      const w = workerRef.current;
      if (w) {
        w.terminate();
        workerRef.current = null;
      }
      readyRef.current = false;
      loadedTierRef.current = null;
      inFlightRef.current = false;
      sessionIdRef.current++;
      clearPending();
    },
    [clearPending],
  );

  return { status, progress, ep, error, resultBlob, process, reset };
}
