/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import type { SegmenterEp, SegmenterRequest, SegmenterResponse } from './segmenter-protocol';

// ===== 校准点:以 docs/id-photo-models.md 实测为准 =====
const INPUT_SIZE = 1024; // BiRefNet/RMBG 惯例输入边长
// 归一化参数由 init 消息传入(模型特定),不再用全局常量
// =====================================================================

ort.env.wasm.wasmPaths = '/onnx/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.proxy = false;

// 最小 WebGPU 探测契约(web app 未引入 @webgpu/types,以本地类型避免硬依赖)
interface GpuAdapterLike {
  requestAdapter(): Promise<unknown>;
}
interface NavigatorGpuLike {
  gpu?: GpuAdapterLike;
}

async function probeWebGpu(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const gpu = (navigator as unknown as NavigatorGpuLike).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/** 单次抓取模型字节并按进度回调;失败由 fetchModelWithProgress 重试。 */
async function fetchOnce(
  url: string,
  onProgress: (ratio: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model fetch failed: ${res.status}`);
  const total = Number(res.headers.get('Content-Length') || 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value!);
    received += value!.length;
    onProgress(total ? received / total : 0);
  }
  const out = new Uint8Array(received);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/**
 * 抓取模型字节,失败重试一次(设计要求)。第一次失败等 500ms 后重试,
 * 第二次仍失败才抛出。onProgress 在每次尝试内独立报告(重试时从 0 重新计数)。
 */
export async function fetchModelWithProgress(
  url: string,
  onProgress: (ratio: number) => void,
): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchOnce(url, onProgress);
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  throw lastErr;
}

export async function detectEp(): Promise<SegmenterEp> {
  return (await probeWebGpu()) ? 'webgpu' : 'wasm';
}

export async function handleInit(
  modelUrl: string,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
  quant: 'fp16' | 'q4f16',
  post: (msg: SegmenterResponse) => void,
): Promise<ort.InferenceSession> {
  // 保存归一化参数供 run 时使用
  normMean = mean;
  normStd = std;
  const ep = await detectEp();
  const bytes = await fetchModelWithProgress(modelUrl, (ratio) =>
    post({ type: 'progress', ratio }),
  );
  // q4f16 量化模型含 MatMulNBits 算子,onnxruntime-web 的 WebGPU EP 不支持;
  // 即便列出 ['webgpu','wasm'],WebGPU 也会在创建/推理时直接抛错而非回退到 wasm,
  // 故 q4f16 强制只用 wasm EP。fp16 模型可走 WebGPU(优先) + wasm 回退;
  // 若 WebGPU 创建整图失败(驱动/显存等),再退回纯 wasm 重试一次。
  // ep 仍按 WebGPU 可用性上报(ready.ep),用于前端高精度开关可用性判断,
  // 与 session 实际后端解耦。
  const useWebGpu = ep === 'webgpu' && quant !== 'q4f16';
  const epCandidates: SegmenterEp[][] = useWebGpu
    ? [['webgpu', 'wasm'], ['wasm']]
    : [['wasm']];
  // q4f16 在 graphOptimizationLevel 'all' 下触发 SimplifiedLayerNormFusion 图错误
  // (InsertedPrecisionFreeCast_.../patch_embed/norm/Constant_output_0 名缺失),
  // session 初始化即抛错 → "处理失败";实测降到 'basic' 可绕过该融合,数值结果
  // 不变(融合仅用于加速)。fp16 在 'all' 下正常(实测),保留以获得加速。
  const optLevel: 'basic' | 'all' = quant === 'q4f16' ? 'basic' : 'all';
  let session: ort.InferenceSession | null = null;
  let lastErr: unknown;
  for (const providers of epCandidates) {
    try {
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: providers,
        graphOptimizationLevel: optLevel,
        enableMemPattern: false,
        enableCpuMemArena: false,
      });
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!session) throw lastErr;
  post({
    type: 'ready',
    ep,
    inputNames: session.inputNames,
    outputNames: session.outputNames,
  });
  return session;
}

/**
 * 把 ImageBitmap 预处理成 NCHW float32 张量数据。
 * RMBG 官方预处理:直接拉伸到 size×size(不 letterbox),再按模型特定 mean/std 归一化。
 */
export function preprocess(
  bitmap: ImageBitmap,
  size: number,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
): { data: Float32Array; dims: [number, number, number, number] } {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  // 拉伸填充整个 canvas(与 RMBG 官方 Image.resize((1024,1024)) 一致)
  ctx.drawImage(bitmap, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  // RGBA → NCHW float32,按通道平面归一化
  const out = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let i = 0; i < plane; i++) {
    out[i] = (data[i * 4]! / 255 - mean[0]) / std[0];
    out[plane + i] = (data[i * 4 + 1]! / 255 - mean[1]) / std[1];
    out[2 * plane + i] = (data[i * 4 + 2]! / 255 - mean[2]) / std[2];
  }
  return { data: out, dims: [1, 3, size, size] };
}

/**
 * 把任意数值 typed array 归一为 Float32Array。
 * - float32:直接返回(零拷贝)
 * - uint8:按 /255 归一(掩码以 0..255 编码时)
 * - 其它类型:best-effort 数值转换;Task 2 实测后可精化(HIGH 5 防御性硬化)
 */
function toF32(
  raw: { readonly length: number; [index: number]: unknown },
  type: string,
): Float32Array {
  if (type === 'float32') return raw as unknown as Float32Array;
  const len = raw.length;
  const f = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const v = Number(raw[i]);
    f[i] = type === 'uint8' ? v / 255 : v;
  }
  return f;
}

/**
 * 从输出张量 dims 推断掩码空间尺寸(NCHW 优先,回退 INPUT_SIZE)。
 * 不再硬编码 INPUT_SIZE,避免与模型实际输出尺寸不一致(LOW 12)。
 */
function inferMaskSize(dims: readonly number[]): { maskH: number; maskW: number } {
  if (dims.length === 4) {
    return { maskH: dims[2] ?? INPUT_SIZE, maskW: dims[3] ?? INPUT_SIZE };
  }
  if (dims.length === 3) {
    return { maskH: dims[1] ?? INPUT_SIZE, maskW: dims[2] ?? INPUT_SIZE };
  }
  return { maskH: INPUT_SIZE, maskW: INPUT_SIZE };
}

/** 把模型输出张量(mask)resize 回原图尺寸的 alpha(0..1)。 */
export function postprocess(
  rawData: Float32Array,
  maskW: number,
  maskH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  // RMBG-1.4 / RMBG-2.0 的 onnx 输出均已 sigmoid(图内含 Sigmoid 节点 / alphas
  // 即 alpha matte),输出已是 [0,1],此处不再重复 sigmoid(否则压缩对比度)。
  // 仅 clamp 到 [0,1] 作安全边界。校准依据见 docs/id-photo-models.md。
  const tmp = new OffscreenCanvas(maskW, maskH);
  const tctx = tmp.getContext('2d')!;
  const img = tctx.createImageData(maskW, maskH);
  for (let i = 0; i < maskW * maskH; i++) {
    const a = Math.max(0, Math.min(1, rawData[i]!));
    img.data[i * 4] = a * 255;
    img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  const out = new OffscreenCanvas(dstW, dstH);
  const octx = out.getContext('2d')!;
  // 高质量插值,减少 mask 缩放锯齿
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(tmp, 0, 0, maskW, maskH, 0, 0, dstW, dstH);
  const resized = octx.getImageData(0, 0, dstW, dstH);
  const alpha = new Float32Array(dstW * dstH);
  for (let i = 0; i < dstW * dstH; i++) {
    alpha[i] = resized.data[i * 4]! / 255;
  }
  return alpha;
}

let session: ort.InferenceSession | null = null;
// 当前 session 的归一化参数(由 init 消息设置)
let normMean: readonly [number, number, number] = [0.5, 0.5, 0.5];
let normStd: readonly [number, number, number] = [0.5, 0.5, 0.5];

// jsdom 无 self.addEventListener,守卫避免加载报错
if (typeof self !== 'undefined' && 'addEventListener' in self) {
  self.addEventListener('message', async (e: MessageEvent<SegmenterRequest>) => {
    const post = (msg: SegmenterResponse) =>
      (self as unknown as Worker).postMessage(msg);
    try {
      if (e.data.type === 'init') {
        session = await handleInit(
          e.data.modelUrl,
          e.data.mean,
          e.data.std,
          e.data.quant,
          post,
        );
      } else if (e.data.type === 'run') {
        if (!session) throw new Error('session not ready');
        const { bitmap, srcW, srcH } = e.data;
        const { data, dims } = preprocess(bitmap, INPUT_SIZE, normMean, normStd);
        const inputName = session.inputNames[0]!;
        const input = new ort.Tensor('float32', data, dims);
        const outputs = await session.run({ [inputName]: input });
        const outputName = session.outputNames[0]!;
        const out = outputs[outputName]!;
        // 从输出张量取类型与 dims,统一转 float32 并按实际尺寸处理(HIGH 5 / LOW 12)
        const raw = await out.getData();
        const rawData = toF32(raw, out.type);
        const { maskH, maskW } = inferMaskSize(out.dims);
        const mask = postprocess(rawData, maskW, maskH, srcW, srcH);
        post({ type: 'result', mask, maskW: srcW, maskH: srcH });
      }
    } catch (err) {
      post({ type: 'error', message: (err as Error).message });
    }
  });
}
