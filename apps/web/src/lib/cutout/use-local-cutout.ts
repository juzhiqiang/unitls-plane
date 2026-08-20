'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type ModelTier } from '@/lib/id-photo-local/model-registry';
import {
  detectLocalEp,
  isStaleSegmentation,
  segmentToCutout,
  type LocalEp,
} from '@/lib/id-photo-local/segmentation';
import { compositeCutout, type CompositeCutoutOptions } from './composite';

export type CutoutStage =
  | 'idle'
  | 'loading-model'
  | 'running'
  | 'compositing'
  | 'done'
  | 'error';

export interface UseLocalCutout {
  status: CutoutStage;
  /** 0..1,仅资产下载阶段有细粒度进度。 */
  progress: number;
  ep: LocalEp | null;
  error: string | null;
  resultBlob: Blob | null;
  process: (
    file: File,
    tier: ModelTier,
    options: CompositeCutoutOptions
  ) => Promise<void>;
  reset: () => void;
}

/**
 * 通用本地抠图。
 *
 * 与 useLocalIdPhoto 共用 segmentation 模块(同一份模型、同一份模块级 pipeline 缓存),
 * 差别只在合成:这里保持原尺寸,输出透明或纯色底。
 */
export function useLocalCutout(): UseLocalCutout {
  const [status, setStatus] = useState<CutoutStage>('idle');
  const [progress, setProgress] = useState(0);
  const [ep, setEp] = useState<LocalEp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);

  const inFlightRef = useRef(false);
  const sessionIdRef = useRef(0);

  const process = useCallback<UseLocalCutout['process']>(
    async (file, tier, options) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const sid = ++sessionIdRef.current;
      setStatus('loading-model');
      setProgress(0);
      setError(null);
      setResultBlob(null);
      const isStale = () => sid !== sessionIdRef.current;

      try {
        const cutout = await segmentToCutout(file, tier, ep ?? 'wasm', {
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
          const blob = await compositeCutout(cutout, options);
          if (isStale()) return;
          setResultBlob(blob);
          setStatus('done');
        } finally {
          cutout.close?.();
        }
      } catch (err) {
        if (isStale() || isStaleSegmentation(err)) return;
        setError((err as Error).message);
        setStatus('error');
      } finally {
        inFlightRef.current = false;
      }
    },
    [ep]
  );

  const reset = useCallback(() => {
    sessionIdRef.current++;
    inFlightRef.current = false;
    setStatus('idle');
    setProgress(0);
    setError(null);
    setResultBlob(null);
  }, []);

  useEffect(
    () => () => {
      sessionIdRef.current++;
      inFlightRef.current = false;
    },
    []
  );

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
