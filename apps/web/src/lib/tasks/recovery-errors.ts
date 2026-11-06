// 工具页现有错误 state 只保留 message；共享面板据稳定消息识别可恢复的等待/提交状态。
export const TASK_SUBMISSION_UNCONFIRMED_MESSAGE =
  'Submission could not be confirmed. Check Recent tasks before submitting again.';
export const TASK_WAIT_TIMEOUT_MESSAGE =
  'Stopped waiting. The task may still be running; check Recent tasks for its result.';
export const TASK_CONTEXT_CHANGED_MESSAGE =
  'Account changed. Check the original account’s task history.';

export function recoveryMessageKey(
  message: string
): 'unconfirmed' | 'waitStopped' | 'contextChanged' | undefined {
  if (message === TASK_SUBMISSION_UNCONFIRMED_MESSAGE) return 'unconfirmed';
  if (message === TASK_WAIT_TIMEOUT_MESSAGE) return 'waitStopped';
  if (message === TASK_CONTEXT_CHANGED_MESSAGE) return 'contextChanged';
  return undefined;
}
