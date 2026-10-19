import { useCallback, useEffect, useRef, useState } from 'react';
import {
  idPhotoPresetSpecs,
  idPhotoCropFromLayout,
  inspectIdPhoto,
  suggestIdPhotoLayout,
  type IdPhotoCrop,
  type IdPhotoLayout,
  type IdPhotoOutputType,
  type IdPhotoPreset,
  type QualityReport,
} from '@utils-plane/validators';
import { compositeIdPhoto } from './composite';
import { detectFaces } from './face-detection';
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
  /** 首次处理算出的自动构图;页面据此回填裁剪框。 */
  autoLayout: IdPhotoLayout | null;
  /** 用户是否手动改过裁剪框;true 时后续不再自动构图。 */
  userOverride: boolean;
  /** 成片质量报告;未处理或处理中为 null。 */
  quality: QualityReport | null;
  process: (
    file: File,
    tier: ModelTier,
    opts: {
      preset: IdPhotoPreset;
      backgroundColor: string;
      outputType: IdPhotoOutputType;
      /** 归一化裁剪参数;省略即居中不放大。 */
      crop?: IdPhotoCrop;
      /** 用户没手动改过裁剪框时传 true,才会跑人脸自动构图。 */
      autoFrame?: boolean;
    }
  ) => Promise<void>;
  markUserOverride: () => void;
  reset: () => void;
}

/**
 * 蒙版 alpha 中第一个「像前景」的像素行,作为真实头顶的 y。
 *
 * YuNet 人脸框上沿在发际线附近,不是头顶;suggestIdPhotoLayout 在有真实头顶
 * 时会据此上移裁剪框。本地路的抠图自带 alpha,不必额外再跑一次分割,直接取
 * 第一个不透明像素所在的扫描行即可。阈值 96 用于跳过边缘的半透明噪点。
 */
function findCrownY(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): number | undefined {
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if ((rgba[rowStart + x * 4 + 3] ?? 0) > 96) return y;
    }
  }
  return undefined;
}

/**
 * 本地证件照抠图(MODNet photographic,经 onnxruntime-web 直接推理)。
 *
 * 资产自托管在 MinIO(见 model-registry),含模型本体与 ort wasm 运行时;
 * session 缓存放在 segmentation 模块作用域,重复处理不会重复下载/建 session。
 * 推理在主线程执行(WebGPU 下更快;CPU wasm 档用 ~25MB photographic,可接受)。
 */
export function useLocalIdPhoto(): UseLocalIdPhoto {
  const [status, setStatus] = useState<LocalStage>('idle');
  const [progress, setProgress] = useState(0);
  const [ep, setEp] = useState<LocalEp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [autoLayout, setAutoLayout] = useState<IdPhotoLayout | null>(null);
  const [userOverride, setUserOverride] = useState(false);
  const [quality, setQuality] = useState<QualityReport | null>(null);

  const markUserOverride = useCallback(() => {
    setUserOverride(true);
  }, []);

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
      setAutoLayout(null);
      setQuality(null);
      const isStale = () => sid !== sessionIdRef.current;
      try {
        const { bitmap: cutoutBitmap, sourceBackground } =
          await segmentToCutout(file, tier, ep ?? 'wasm', {
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
          const targetAspect = spec.widthPx / spec.heightPx;
          const sourceSize = {
            width: cutoutBitmap.width,
            height: cutoutBitmap.height,
          };

          // 1) 先把抠图读成像素:质量检查和 crownY 估算共用这一份。
          //    必须在合成前读,finally 会 close 掉 bitmap。
          const srcCanvas = new OffscreenCanvas(
            cutoutBitmap.width,
            cutoutBitmap.height
          );
          const sctx = srcCanvas.getContext('2d');
          if (!sctx) throw new Error('2D canvas context unavailable');
          sctx.drawImage(cutoutBitmap, 0, 0);
          const srcData = sctx.getImageData(
            0,
            0,
            cutoutBitmap.width,
            cutoutBitmap.height
          );

          // 2) 只在「用户没手动改过裁剪框」时才自动构图。
          let crop = opts.crop;
          let rotation = 0;
          let layout: IdPhotoLayout | null = null;
          let faces: Awaited<ReturnType<typeof detectFaces>> = [];

          if (opts.autoFrame && !userOverride) {
            faces = await detectFaces(file);
            if (isStale()) return;

            // 抠图的 alpha 就是蒙版:第一行不透明像素即真实头顶。
            const crownY = findCrownY(
              srcData.data,
              cutoutBitmap.width,
              cutoutBitmap.height
            );
            layout = suggestIdPhotoLayout(
              faces[0] ?? null,
              sourceSize,
              targetAspect,
              crownY
            );
            if (layout) {
              crop = idPhotoCropFromLayout(layout, sourceSize, targetAspect);
              rotation = layout.rotation;
            }
          }

          // 3) 合成(去污染 + 旋转 + DPI 都在 composite 内完成)。
          const blob = await compositeIdPhoto(
            cutoutBitmap,
            opts.backgroundColor,
            spec.widthPx,
            spec.heightPx,
            opts.outputType,
            crop,
            rotation,
            sourceBackground
          );
          if (isStale()) return;

          // 4) 质量检查:源图像素 + 人脸 + 原始 alpha。
          const pixelCount = cutoutBitmap.width * cutoutBitmap.height;
          const alphaChannel = new Uint8ClampedArray(pixelCount);
          for (let i = 0; i < pixelCount; i += 1) {
            alphaChannel[i] = srcData.data[i * 4 + 3] ?? 0;
          }

          setAutoLayout(layout);
          setQuality(
            inspectIdPhoto({
              // RGBA;inspectIdPhoto 按缓冲区长度自动识别 4 通道。
              rgb: srcData.data,
              width: cutoutBitmap.width,
              height: cutoutBitmap.height,
              face: faces[0] ?? null,
              faceCount: faces.length,
              alpha: alphaChannel,
            })
          );
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
    [ep, userOverride]
  );

  const reset = useCallback(() => {
    // 使在途 removeBackground/进度回调失效;ep 保留(WebGPU 探测结果不随 reset 失效)。
    sessionIdRef.current++;
    inFlightRef.current = false;
    setStatus('idle');
    setProgress(0);
    setError(null);
    setResultBlob(null);
    setAutoLayout(null);
    setUserOverride(false);
    setQuality(null);
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

  return {
    status,
    progress,
    ep,
    error,
    resultBlob,
    autoLayout,
    userOverride,
    quality,
    process,
    markUserOverride,
    reset,
  };
}
