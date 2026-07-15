import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

it('registers the cleanup queue used for durable upload compensation', () => {
  const source = readFileSync(join(import.meta.dir, 'files.module.ts'), 'utf8');

  expect(source).toContain(
    "BullModule.registerQueue({ name: 'cleanup-queue' })"
  );
});
