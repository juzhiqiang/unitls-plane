import { expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../../..');
const trackerPackage = ['@error', 'tracker/sdk'].join('-');
const trackerContext = ['error', 'tracker', 'sdk'].join('_');

it('keeps runtime and Docker builds free of telemetry integrations', () => {
  for (const file of [
    'package.json',
    'apps/api/package.json',
    'apps/web/package.json',
    'apps/api/src/main.ts',
    'apps/web/src/app/[locale]/layout.tsx',
    'Dockerfile',
    'apps/api/Dockerfile',
  ]) {
    const source = readFileSync(join(repoRoot, file), 'utf8');
    expect(source).not.toContain(trackerPackage);
    expect(source).not.toContain(trackerContext);
    expect(source).not.toContain('ReplayPlugin');
  }

  for (const obsoleteDoc of [
    'docs/superpowers/specs/2026-06-18-local-error-tracker-sdk-integration-design.md',
    'docs/superpowers/plans/2026-06-18-local-error-tracker-sdk-integration.md',
  ]) {
    expect(existsSync(join(repoRoot, obsoleteDoc))).toBe(false);
  }
});
