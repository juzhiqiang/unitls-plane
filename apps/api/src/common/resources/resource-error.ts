import { UnrecoverableError } from 'bullmq';

/** 确定性资源超限：不能换源或重新运行同一份输入。 */
export class TaskResourceLimitError extends UnrecoverableError {
  readonly code = 'TASK_RESOURCE_LIMIT_EXCEEDED';
  readonly retryable = false;

  constructor(detail: string) {
    super(
      `Task resource limit exceeded: ${detail}. Reduce file size, image resolution or page count.`
    );
  }
}
