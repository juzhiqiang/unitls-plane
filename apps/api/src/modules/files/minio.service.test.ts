import { describe, expect, it, vi } from 'bun:test';
import { MinioService } from './minio.service';

describe('MinioService delete logging', () => {
  it('does not log the storage key or filename after a successful delete', async () => {
    const storageKey = 'anonymous/file-1/private-report.pdf';
    const send = vi.fn(async () => ({}));
    const service = new MinioService();
    const testableService = service as unknown as {
      client: { send: typeof send };
      logger: { debug: (...args: unknown[]) => void };
    };
    testableService.client = { send };
    const debug = vi
      .spyOn(testableService.logger, 'debug')
      .mockImplementation(() => undefined);

    await service.delete(storageKey);

    expect(send).toHaveBeenCalledTimes(1);
    const debugOutput = debug.mock.calls.flat().map(String).join(' ');
    expect(debugOutput).not.toContain(storageKey);
    expect(debugOutput).not.toContain('private-report.pdf');
  });
});
