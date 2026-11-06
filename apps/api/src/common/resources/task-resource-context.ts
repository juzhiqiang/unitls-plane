import { AsyncLocalStorage } from 'node:async_hooks';
import sharp from 'sharp';
import { readBoundedStream } from './bounded-read';
import { resourceLimits, type ResourceLimits } from './resource-limits';
import { TaskResourceLimitError } from './resource-error';

type InputFile = { originalSize: number; mimeType: string };
type TaskResources = {
  limits: ResourceLimits;
  inputBytes: number;
  files: Map<string, InputFile>;
  bytesRead: number;
  pixelsRead: number;
  pdfPagesRead: number;
};
const storage = new AsyncLocalStorage<TaskResources>();

export function currentTaskResources() {
  return storage.getStore();
}
export function currentResourceLimits() {
  return storage.getStore()?.limits ?? resourceLimits();
}

export function runWithTaskResources<T>(
  resources: Omit<TaskResources, 'bytesRead' | 'pixelsRead' | 'pdfPagesRead'>,
  operation: () => Promise<T>
): Promise<T> {
  return storage.run(
    { ...resources, bytesRead: 0, pixelsRead: 0, pdfPagesRead: 0 },
    operation
  );
}

export function assertPdfPages(count: number, consume = false): void {
  const resources = storage.getStore();
  const total =
    consume && resources ? (resources.pdfPagesRead += count) : count;
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    total > currentResourceLimits().pdfPages
  )
    throw new TaskResourceLimitError('PDF page budget exceeded');
}

export function assertRasterPixels(
  bounds: readonly number[],
  scale: number
): void {
  // MuPDF 会对变换后的坐标向外取整，不能只对宽高四舍五入。
  const width = Math.ceil(bounds[2]! * scale) - Math.floor(bounds[0]! * scale);
  const height = Math.ceil(bounds[3]! * scale) - Math.floor(bounds[1]! * scale);
  const pixels = width * height;
  if (
    !Number.isFinite(pixels) ||
    width <= 0 ||
    height <= 0 ||
    pixels > currentResourceLimits().pdfRenderPixels
  )
    throw new TaskResourceLimitError('PDF raster pixel budget exceeded');
}

export async function assertTaskPdf(buffer: Buffer): Promise<void> {
  const { getMupdf } =
    await import('../../modules/tasks/services/pdf/mupdf-runtime');
  const mupdf = await getMupdf();
  // 损坏/加密文件留给具体 handler 保持已有错误契约；仅资源超限在这里终止。
  let document: import('mupdf').Document;
  try {
    document = mupdf.Document.openDocument(buffer, 'application/pdf');
  } catch {
    return;
  }
  try {
    if (!document.needsPassword()) assertPdfPages(document.countPages(), true);
  } finally {
    document.destroy();
  }
}

export function assertTaskOutput(bytes: number): void {
  if (bytes > currentResourceLimits().outputBytes)
    throw new TaskResourceLimitError('output byte budget exceeded');
}

export async function readTaskInput(
  stream: Parameters<typeof readBoundedStream>[0],
  maxBytes?: number,
  signal?: globalThis.AbortSignal
): Promise<Buffer> {
  const resources = storage.getStore();
  return readBoundedStream(
    stream,
    maxBytes ?? resources?.inputBytes ?? currentResourceLimits().inputBytes,
    bytes => {
      if (!resources) return;
      resources.bytesRead += bytes;
      if (resources.bytesRead > resources.inputBytes)
        throw new TaskResourceLimitError('total input exceeds reserved bytes');
    },
    signal
  );
}

/** 只读取头部，不触发完整解码；动图按全部帧保守计费。 */
export async function assertTaskImage(
  buffer: Buffer,
  consume = true
): Promise<void> {
  const resources = storage.getStore();
  const limit = currentResourceLimits().imagePixels;
  const image = sharp(buffer, { limitInputPixels: false });
  try {
    const metadata = await image.metadata();
    const pixels =
      (metadata.width ?? 0) *
      (metadata.pageHeight ?? metadata.height ?? 0) *
      (metadata.pages ?? 1);
    if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > limit)
      throw new TaskResourceLimitError('image pixel budget exceeded');
    if (resources && consume) {
      resources.pixelsRead += pixels;
      if (resources.pixelsRead > limit)
        throw new TaskResourceLimitError('total decoded image pixels exceeded');
    }
  } finally {
    image.destroy();
  }
}
