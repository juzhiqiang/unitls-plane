import type { Job } from 'bullmq';

/**
 * 一次 attempt 失败后的落库判定。
 *
 * BullMQ 的重试是「把 process() 从头再跑一遍」,所以每个 processor 的 catch 都会在
 * 每一次 attempt 上执行。如果在那里无条件 markFailed,任务记录会在第一次失败的瞬间
 * 变成 failed —— 前端把 failed 当终态,轮询立刻停掉;后面某次 attempt 成功了也没人再看,
 * 页面永远停在报错上(产物只能在文件列表里找到)。所以「失败」要等重试真正用尽再落库。
 */

/** 带可重试标记的错误。只有显式 `retryable: false` 才算确定性失败。 */
export interface RetryableAwareError {
  retryable?: boolean;
}

/**
 * 下一次 attempt 有机会成功吗。
 *
 * 默认 true:普通 Error(sharp 解码、MinIO 抖动、pdf-lib 抛错)沿用既有的重试行为。
 * 内容策略拒绝、参数非法这类重来一次也必然一样的错误,由抛出方标 retryable: false。
 */
export function isRetryableError(error: unknown): boolean {
  return (error as RetryableAwareError | null)?.retryable !== false;
}

/**
 * 本次 attempt 是不是最后一次。
 *
 * process() 里 job.attemptsMade 还没算上正在跑的这一次(第一次进来是 0),要 +1 再比。
 * opts.attempts 读不到时按 1 处理:宁可提前把失败落库,也不要让任务永远停在 processing。
 */
export function isFinalAttempt(
  job: Pick<Job, 'attemptsMade' | 'opts'>
): boolean {
  const maxAttempts = job.opts?.attempts ?? 1;
  return job.attemptsMade + 1 >= maxAttempts;
}

/** 这次失败要不要立刻写进任务记录:不会再重试了才写。 */
export function shouldRecordFailure(
  job: Pick<Job, 'attemptsMade' | 'opts'>,
  error: unknown
): boolean {
  return !isRetryableError(error) || isFinalAttempt(job);
}

/**
 * 重试次数是否已经用尽。给 `@OnWorkerEvent('failed')` 用。
 *
 * 与 isFinalAttempt 的差别只在计数时点:'failed' 事件里 attemptsMade 已经算上刚失败的
 * 那一次,所以不再 +1。读不到上限时同样按 1 处理 —— 宁可多写一次 failed,也不要让任务
 * 卡在 processing 让前端一直转。
 */
export function hasExhaustedAttempts(
  job: Pick<Job, 'attemptsMade' | 'opts'>
): boolean {
  return job.attemptsMade >= (job.opts?.attempts ?? 1);
}
