import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

it('registers all task queues and provides account task cleanup', () => {
  const source = readFileSync(
    join(import.meta.dir, 'account.module.ts'),
    'utf8'
  );

  for (const queue of ['image-queue', 'pdf-queue', 'font-queue', 'ai-queue']) {
    expect(source).toContain(`{ name: '${queue}' }`);
  }
  expect(source).toContain('AccountTaskQueueService');
});
