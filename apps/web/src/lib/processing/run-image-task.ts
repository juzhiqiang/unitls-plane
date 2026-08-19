import { waitForTask } from '@/lib/wait-for-task';

/**
 * 「上传 → 建任务 → 等完成 → 下载产物」这一串,compress / convert / watermark
 * 三条服务端路都要走一遍。
 *
 * 抽出来之前 compress 页是手写的 `while (true)` + 1s sleep:没有超时、没有中止,
 * 批量处理时 N 个文件就是 N 条永不放弃的轮询。这里统一改走 waitForTask ——
 * 它早就存在并且带超时与进度回调,只是一直没人用。
 */
export interface RunImageTaskOptions {
  file: File;
  type: string;
  inputConfig: Record<string, unknown>;
  /** 产物文件名(扩展名由调用方按目标格式决定)。 */
  outputName: string;
  upload: (file: File) => Promise<unknown>;
  createTask: (input: unknown) => Promise<{ id: string }>;
  /** 0..100。上传与建任务各占一小段,其余交给任务自身的进度。 */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

const UPLOAD_DONE_PROGRESS = 10;
const TASK_CREATED_PROGRESS = 15;

export async function runImageTask({
  file,
  type,
  inputConfig,
  outputName,
  upload,
  createTask,
  onProgress,
  signal,
}: RunImageTaskOptions): Promise<File> {
  onProgress?.(0);
  const uploaded = (await upload(file)) as { id: string };
  if (signal?.aborted) throw new Error('Aborted');
  onProgress?.(UPLOAD_DONE_PROGRESS);

  const task = await createTask({
    type,
    inputFileIds: [uploaded.id],
    inputConfig,
  });
  if (signal?.aborted) throw new Error('Aborted');
  onProgress?.(TASK_CREATED_PROGRESS);

  const { outputFileId } = await waitForTask(task.id, {
    onProgress: value => {
      // 任务进度是 0..100,压到上传之后的剩余区间,避免进度条回退。
      const scaled =
        TASK_CREATED_PROGRESS +
        (value / 100) * (100 - TASK_CREATED_PROGRESS - 5);
      onProgress?.(Math.round(scaled));
    },
  });

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
    { credentials: 'include', signal }
  );
  if (!response.ok) throw new Error('Failed to download result');

  const blob = await response.blob();
  onProgress?.(100);
  return new File([blob], outputName, { type: blob.type });
}
