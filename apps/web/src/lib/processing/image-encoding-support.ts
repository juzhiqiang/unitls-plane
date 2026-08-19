/**
 * 浏览器本地编码能力探测。
 *
 * `canvas.toBlob(cb, type)` 在遇到不支持的 MIME 时不会报错,而是**静默产出 PNG**
 * (规范行为)。直接把 AVIF 加进选项而不探测,结果就是用户下载到一个内容是 PNG、
 * 扩展名却是 .avif 的文件 —— 比不支持更糟。
 *
 * 因此所有非 JPEG/PNG 的输出格式,都必须先过一遍这里的探测。
 */

export type EncodableImageType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/avif';

/** JPEG 与 PNG 是 canvas 规范要求必须支持的,无需探测。 */
const ALWAYS_ENCODABLE: readonly string[] = ['image/jpeg', 'image/png'];

const probes = new Map<string, Promise<boolean>>();

async function probeEncoding(type: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  // 部分浏览器要求画布已有绘图上下文,否则 toBlob 直接给 null。
  if (!canvas.getContext('2d')) return false;

  const blob = await new Promise<Blob | null>(resolve => {
    try {
      canvas.toBlob(resolve, type);
    } catch {
      resolve(null);
    }
  });

  // 回退发生时 blob.type 会是 'image/png',与请求的 type 不一致。
  return blob?.type === type;
}

export function canEncodeImageType(type: string): Promise<boolean> {
  if (ALWAYS_ENCODABLE.includes(type)) return Promise.resolve(true);

  const cached = probes.get(type);
  if (cached) return cached;

  const probe = probeEncoding(type);
  probes.set(type, probe);
  return probe;
}

/** 仅供测试重置探测缓存。 */
export function resetImageEncodingProbes(): void {
  probes.clear();
}

/**
 * 校验 canvas 产出的 blob 确实是请求的格式,不是静默回退的产物。
 * 在编码路径上兜底,即使调用方漏了探测也不会产出扩展名与内容不符的文件。
 */
export function assertEncodedAs(blob: Blob, expected: string): void {
  if (blob.type !== expected) {
    throw new Error(`Browser cannot encode ${expected}`);
  }
}
