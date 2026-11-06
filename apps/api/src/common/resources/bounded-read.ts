import type { Readable } from 'node:stream';
import { TaskResourceLimitError } from './resource-error';

export async function readBoundedStream(
  stream: AsyncIterable<Uint8Array> & { destroy?: Readable['destroy'] },
  maxBytes: number,
  onChunk?: (bytes: number) => void,
  signal?: globalThis.AbortSignal
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    stream.destroy?.(new Error('Input download aborted'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    for await (const chunk of stream) {
      total += chunk.byteLength;
      if (total > maxBytes)
        throw new TaskResourceLimitError('input byte budget exceeded');
      onChunk?.(chunk.byteLength);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal?.removeEventListener('abort', abort);
    stream.destroy?.();
  }
}

export async function readBoundedResponse(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (Number(response.headers.get('content-length')) > maxBytes)
      throw new TaskResourceLimitError('response byte budget exceeded');
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes)
        throw new TaskResourceLimitError('response byte budget exceeded');
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
