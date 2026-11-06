import { TaskResourceLimitError } from './resource-error';

export const MiB = 1024 * 1024;

function integer(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  max: number
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  ) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

export function resourceLimits(
  env: Record<string, string | undefined> = process.env
) {
  return {
    memoryBytes: integer(env, 'WORKER_MEMORY_BUDGET_MB', 1024, 65536) * MiB,
    cpu: integer(env, 'WORKER_CPU_BUDGET', 4, 128),
    inputBytes: integer(env, 'TASK_MAX_INPUT_MB', 128, 1024) * MiB,
    imagePixels: integer(env, 'TASK_MAX_IMAGE_PIXELS', 32_000_000, 100_000_000),
    pdfRenderPixels: integer(
      env,
      'TASK_MAX_PDF_RENDER_PIXELS',
      16_000_000,
      100_000_000
    ),
    pdfPages: 500,
    pdfRenderPages: 100,
    outputBytes: 64 * MiB,
    generatedImageBytes: 32 * MiB,
    providerResponseBytes: 48 * MiB,
    libraryImageBytes: 20 * MiB,
  };
}

export type ResourceLimits = ReturnType<typeof resourceLimits>;
export type ResourceCost = { memoryBytes: number; cpu: number };

/** 同一事件循环中同步检查并预留，避免分别等待两种资源形成死锁。 */
export class ResourcePool {
  private memoryUsed = 0;
  private cpuUsed = 0;

  constructor(
    private readonly memoryBytes: number,
    private readonly cpu: number
  ) {}

  tryAcquire(cost: ResourceCost): (() => void) | null {
    if (
      !Number.isFinite(cost.memoryBytes) ||
      cost.memoryBytes <= 0 ||
      !Number.isInteger(cost.cpu) ||
      cost.cpu <= 0 ||
      cost.memoryBytes > this.memoryBytes ||
      cost.cpu > this.cpu
    ) {
      throw new TaskResourceLimitError(
        'estimated task cost exceeds worker capacity'
      );
    }
    if (
      this.memoryUsed + cost.memoryBytes > this.memoryBytes ||
      this.cpuUsed + cost.cpu > this.cpu
    )
      return null;
    this.memoryUsed += cost.memoryBytes;
    this.cpuUsed += cost.cpu;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.memoryUsed -= cost.memoryBytes;
      this.cpuUsed -= cost.cpu;
    };
  }
}
