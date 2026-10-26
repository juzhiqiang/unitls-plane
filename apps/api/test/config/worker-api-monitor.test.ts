import { afterEach, expect, it, spyOn } from 'bun:test';
import { WorkerApiMonitor } from '../../src/config/worker-api-monitor';

const originalUrl = process.env.WORKER_API_READY_URL;
afterEach(() => {
  if (originalUrl === undefined) delete process.env.WORKER_API_READY_URL;
  else process.env.WORKER_API_READY_URL = originalUrl;
});

it('does not probe the API in standalone and all mode without a configured URL', async () => {
  delete process.env.WORKER_API_READY_URL;
  const fetchSpy = spyOn(globalThis, 'fetch');
  const monitor = new WorkerApiMonitor();
  try {
    await monitor.onModuleInit();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    monitor.onModuleDestroy();
    fetchSpy.mockRestore();
  }
});

it('rejects worker startup when the configured API is not ready', async () => {
  process.env.WORKER_API_READY_URL = 'http://api:3001/health/ready';
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, { status: 503 })
  );
  const monitor = new WorkerApiMonitor();
  try {
    await expect(monitor.onModuleInit()).rejects.toThrow('API');
  } finally {
    monitor.onModuleDestroy();
    fetchSpy.mockRestore();
  }
});

it('requests Nest SIGTERM shutdown once when a running API disappears', async () => {
  process.env.WORKER_API_READY_URL = 'http://api:3001/health/ready';
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, { status: 200 })
  );
  let tick: () => Promise<void> = async () => undefined;
  const intervalSpy = spyOn(globalThis, 'setInterval').mockImplementation(
    callback => {
      tick = callback as () => Promise<void>;
      return {
        unref() {
          return this;
        },
      } as unknown as ReturnType<typeof globalThis.setInterval>;
    }
  );
  const clearSpy = spyOn(globalThis, 'clearInterval').mockImplementation(
    () => undefined
  );
  const killSpy = spyOn(process, 'kill').mockReturnValue(true);
  const monitor = new WorkerApiMonitor();
  try {
    await monitor.onModuleInit();
    expect(killSpy).not.toHaveBeenCalled();
    fetchSpy.mockRejectedValue(new Error('connection refused'));
    await tick();
    await tick();
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  } finally {
    monitor.onModuleDestroy();
    fetchSpy.mockRestore();
    intervalSpy.mockRestore();
    clearSpy.mockRestore();
    killSpy.mockRestore();
  }
});
