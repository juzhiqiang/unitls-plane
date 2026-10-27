import { expect, it, spyOn } from 'bun:test';
import Redis, { Command } from 'ioredis';
import { bullConfig } from '../../src/config/bull.config';

it('settles abandoned blocking commands while Redis is reconnecting', async () => {
  const provider = bullConfig.providers?.find(
    item => typeof item === 'object' && 'useFactory' in item
  );
  if (
    !provider ||
    typeof provider !== 'object' ||
    !('useFactory' in provider)
  ) {
    throw new Error('BullMQ configuration factory not found');
  }
  const options = provider.useFactory() as { connection: Redis['options'] };
  const client = new Redis({ ...options.connection, lazyConnect: true });
  // 模拟实测中的状态：没有可用 socket，阻塞命令尚未收到回复。
  Reflect.set(client, 'status', 'reconnecting');
  Reflect.set(client, 'condition', { select: 0 });
  const command = new Command('bzpopmin', ['validation-marker', '10']);
  const nativeTimeout = command.setBlockingTimeout.bind(command);
  const timeoutSpy = spyOn(command, 'setBlockingTimeout').mockImplementation(
    milliseconds => nativeTimeout(Math.min(milliseconds, 25))
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      client.sendCommand(command).then(
        value => value,
        (error: Error) => error.message
      ),
      new Promise<string>(resolve => {
        timer = setTimeout(() => resolve('still-waiting'), 250);
      }),
    ]);
    expect(outcome).not.toBe('still-waiting');
    // Redis 的有限阻塞超时等价于空结果，BullMQ 随后能退出等待循环。
    expect(outcome).toBeNull();
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  } finally {
    if (timer) clearTimeout(timer);
    Reflect.apply(Reflect.get(client, 'flushQueue'), client, [
      new Error('test cleanup'),
    ]);
    client.disconnect();
    timeoutSpy.mockRestore();
  }
});
