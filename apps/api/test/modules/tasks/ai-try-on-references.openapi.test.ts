import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

it('describes reference tags as a flat string array for generated clients', () => {
  const document = JSON.parse(
    readFileSync(join(import.meta.dir, '../../../openapi.json'), 'utf8')
  );
  const tags = document.components.schemas.AiTryOnReferenceDto.properties.tags;

  expect(tags.type).toBe('array');
  expect(tags.items).toEqual({ type: 'string' });
});
