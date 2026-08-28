import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { APP_VERSION, APP_VERSION_LABEL } from './release';

const manifests = [
  'package.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'packages/auth/package.json',
  'packages/db/package.json',
  'packages/utils/package.json',
  'packages/validators/package.json',
  'packages/api-client/package.json',
];

describe('release version', () => {
  it('uses v0.6.0 in shared release metadata', () => {
    expect(APP_VERSION).toBe('0.6.0');
    expect(APP_VERSION_LABEL).toBe('v0.6.0');
  });

  it.each(manifests)('keeps %s on the shared version', path => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../../..', path), 'utf8')
    );

    expect(manifest.version).toBe(APP_VERSION);
  });
});
