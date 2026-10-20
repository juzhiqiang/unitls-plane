import { useCallback, useEffect, useRef, useState } from 'react';
import {
  idPhotoPresetSpecs,
  idPhotoCropFromLayout,
  inspectIdPhoto,
  mapFaceToOutput,
  resolveIdPhotoCropBox,
  suggestIdPhotoLayout,
  type IdPhotoCrop,
  type IdPhotoLayout,
  type IdPhotoOutputType,
  type IdPhotoPreset,
  type QualityReport,
} from '@utils-plane/validators';
import { findCrownY } from '@utils-plane/utils';
import { compositeIdPhoto, type CompositeOutputPixels } from './composite';
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

/**
 * 本地证件照管线的源图长边上限(像素)。
 *
 * 依据:最大规格二寸为 413×626,`IdPhotoCrop.scale` 上限为 3,
 * 626 × 3 = 1878 < 2048 —— 在纵向源图上,即使放大到最大倍数,裁剪框
 * 也仍有不少于成片的像素,缩放不会让成片像素不足。小于上限的图不放大。
 *
 * 不设上限时 48MP 照片会以全分辨率解码、生成 cutout 并 getImageData,
 * 占用数百 MB,移动端会直接崩溃。
 */
export const ID_PHOTO_LOCAL_MAX_SOURCE_EDGE = 2048;

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
  /**
   * 只清本次处理结果与状态,保留 `userOverride`。
   * 切换本地/服务端模式时使用:两条路共用同一个裁剪框,用户手动调过的构图
   * 必须继续有效(服务端据此决定是否发送 crop)。
   */
  resetResult: () => void;
  /**
   * 清结果并清掉 `userOverride`。换图时使用:新图不应继承上一张图的手动构图。
   */
  resetAll: () => void;
}

/**
 * 收窄合成回调写回的像素。
 *
 * TypeScript 的控制流分析看不到「回调里对局部变量的赋值」,会把变量
 * 一直窄化成 null;用函数参数重新建立联合类型,避免误报 never。
 */
function requireOutputPixels(
  pixels: CompositeOutputPixels | null
): CompositeOutputPixels {
  if (!pixels) throw new Error('composite did not expose output pixels');
  return pixels;
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

  // 守卫必须用 ref:同一事件里可能先 markUserOverride() 再立刻 process(),
  // 此时 state 还没触发重渲染,process 的闭包仍会读到旧的 false。
  // state 只负责渲染(例如页面据此隐藏「重新自动构图」入口)。
  const userOverrideRef = useRef(false);

  const markUserOverride = useCallback(() => {
    userOverrideRef.current = true;
    setUserOverride(true);
    // 页面层可能用 autoLayout 回填裁剪框。用户已经手动改框后必须清掉它,
    // 否则一次重渲染就会把自动构图的结果重新灌回去。
    setAutoLayout(null);
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
        // 源图在分割入口就按长边上限缩放;返回的 source 与 cutout 同尺寸,
        // 后续人脸检测、crownY、构图与底色估计都在这一个坐标系里进行,
        // 不再解码第二次原图。
        const { bitmap: cutoutBitmap, source: sourceBitmap } =
          await segmentToCutout(file, tier, ep ?? 'wasm', {
            onDownloadProgress: ratio => {
              if (isStale()) return;
              setProgress(ratio);
              setStatus('loading-model');
            },
            isStale,
            maxSourceEdge: ID_PHOTO_LOCAL_MAX_SOURCE_EDGE,
          });

        try {
          if (isStale()) return;

          // 人脸检测与构图属于「处理中」(running),不是合成阶段。
          setStatus('running');
          const spec = idPhotoPresetSpecs[opts.preset];
          if (!spec) throw new Error(`unknown preset: ${opts.preset}`);
          const targetAspect = spec.widthPx / spec.heightPx;
          const sourceSize = {
            width: cutoutBitmap.width,
            height: cutoutBitmap.height,
          };

          // 1) 只在「用户没手动改过裁剪框」时才自动构图。
          //    守卫读 ref:同一事件里先 markUserOverride() 再 process() 时,
          //    state 尚未重渲染,不能依赖闭包里的 userOverride。
          //    亮度自动校正也只在自动模式下生效:用户手动构图时不自动调色。
          const autoFraming = Boolean(
            opts.autoFrame && !userOverrideRef.current
          );
          let crop = opts.crop;
          let rotation = 0;
          let layout: IdPhotoLayout | null = null;
          let faces: Awaited<ReturnType<typeof detectFaces>> = [];

          if (autoFraming) {
            faces = await detectFaces(sourceBitmap);
            if (isStale()) return;

            // 抠图的 alpha 就是蒙版:第一条合格的不透明行即真实头顶。
            // 只有自动构图需要它,因此只在这里把 cutout 读成像素;必须在
            // 合成前读,finally 会 close 掉 bitmap。
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
            // 行门槛与服务端共用 packages/utils 的 findCrownY(RGBA 步长 4)。
            const crownY = findCrownY(
              srcData.data,
              cutoutBitmap.width,
              cutoutBitmap.height,
              4
            );
            layout = suggestIdPhotoLayout(
              faces[0] ?? null,
              sourceSize,
              targetAspect,
              crownY
            );
            if (layout) {
              crop = idPhotoCropFromLayout(layout, sourceSize, targetAspect);
              // 防御:非有限角度会让 canvas 旋转与 mapFaceToOutput 失真,按 0 处理。
              rotation = Number.isFinite(layout.rotation) ? layout.rotation : 0;
            }
          }

          // 1.5) 亮度自动校正不再在整幅 cutout 上预算，而是交给 composite
          //      在裁剪后的成片尺寸上、只对 alpha > 0 的前景求均值，与服务端
          //      同一口径。手动构图（userOverride）时不启用。

          // 2) 合成(去污染 + 旋转 + DPI 都在 composite 内完成),同时拿回
          //    成片尺寸的像素供质量检查。源图用于在「裁剪后的成片尺寸」上
          //    估计底色，与服务端同一语义。
          setStatus('compositing');
          let pixelsFromComposite: CompositeOutputPixels | null = null;
          const blob = await compositeIdPhoto(
            cutoutBitmap,
            opts.backgroundColor,
            spec.widthPx,
            spec.heightPx,
            opts.outputType,
            crop,
            rotation,
            sourceBitmap,
            autoFraming ? 'auto' : 0,
            pixels => {
              pixelsFromComposite = pixels;
            }
          );
          if (isStale()) return;
          const outputPixels = requireOutputPixels(pixelsFromComposite);

          // 4) 质量检查必须在成片坐标上做:人脸框/关键点先从源图映射到
          //    成片(裁剪 + 缩放 + 旋转),rgb/alpha 也用成片尺寸的像素。
          //    否则自动构图已经居中的照片仍会因按源图尺寸计算而判失败。
          //    映射失败(坐标非有限)时为 null,按「无人脸」交给质量检查,
          //    faceCount 仍照实际检测数报告。
          const baseBox = resolveIdPhotoCropBox(
            sourceSize.width,
            sourceSize.height,
            spec.widthPx,
            spec.heightPx,
            crop
          );
          const outputFace = faces[0]
            ? mapFaceToOutput(
                faces[0],
                baseBox,
                { widthPx: spec.widthPx, heightPx: spec.heightPx },
                rotation
              )
            : null;

          setAutoLayout(layout);
          setQuality(
            inspectIdPhoto({
              // RGBA;inspectIdPhoto 按缓冲区长度自动识别 4 通道。
              rgb: outputPixels.rgba,
              width: outputPixels.width,
              height: outputPixels.height,
              face: outputFace,
              faceCount: faces.length,
              alpha: outputPixels.alpha,
            })
          );
          setResultBlob(blob);
          setStatus('done');
        } finally {
          // 两个位图都归 hook 所有(分割阶段已移交),任何退出路径都要释放。
          sourceBitmap.close?.();
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

  const resetCommon = useCallback((clearOverride: boolean) => {
    // 使在途 removeBackground/进度回调失效;ep 保留(WebGPU 探测结果不随 reset 失效)。
    sessionIdRef.current++;
    inFlightRef.current = false;
    setStatus('idle');
    setProgress(0);
    setError(null);
    setResultBlob(null);
    setAutoLayout(null);
    setQuality(null);
    if (clearOverride) {
      userOverrideRef.current = false;
      setUserOverride(false);
    }
  }, []);

  // 切模式只清结果:裁剪框(以及 options.crop)在两条路之间共享,清掉 override
  // 会让服务端误判为「用户没调过」而用自动构图覆盖掉用户刚拖好的框。
  const resetResult = useCallback(() => resetCommon(false), [resetCommon]);
  // 换图必须连 override 一起清,否则新图永远走不到自动构图。
  const resetAll = useCallback(() => resetCommon(true), [resetCommon]);

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
    resetResult,
    resetAll,
  };
}
