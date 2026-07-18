import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const repoRoot = join(import.meta.dir, '../../../..');

describe('Dockerfile runtime assets', () => {
  it('copies portrait segmentation ONNX models into the runtime image', () => {
    const source = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');

    expect(source).toContain(
      'COPY --from=builder /app/apps/api/models ./models'
    );
  });

  it('builds and copies the shared utils package into runtime images', () => {
    const dockerfiles = [
      readFileSync(join(repoRoot, 'Dockerfile'), 'utf8'),
      readFileSync(join(repoRoot, 'apps/api/Dockerfile'), 'utf8'),
    ];

    for (const source of dockerfiles) {
      expect(source).toContain('packages/utils/tsconfig.json');
      expect(source).toContain(
        'COPY --from=builder /app/packages/utils/package.json ./packages/utils/package.json'
      );
      expect(source).toContain(
        'COPY --from=builder /app/packages/utils/dist-cjs ./packages/utils/dist-cjs'
      );
      expect(source).toContain("patch('packages/utils/package.json'");
    }
  });

  it('runs the production API with Node-compatible runtime dependencies', () => {
    const combinedDockerfile = readFileSync(
      join(repoRoot, 'Dockerfile'),
      'utf8'
    );
    const apiDockerfile = readFileSync(
      join(repoRoot, 'apps/api/Dockerfile'),
      'utf8'
    );
    const combinedEntrypoint = readFileSync(
      join(repoRoot, 'docker/start-all.sh'),
      'utf8'
    );
    const productionCompose = readFileSync(
      join(repoRoot, 'docker-compose.prod.yml'),
      'utf8'
    );
    const accountExportService = readFileSync(
      join(repoRoot, 'apps/api/src/modules/account/account-export.service.ts'),
      'utf8'
    );

    for (const source of [combinedDockerfile, apiDockerfile]) {
      expect(source).not.toContain(
        'COPY --from=base /usr/local/bin/bun /usr/local/bin/bun'
      );
      expect(source).not.toContain('cp -RL apps/api/node_modules');
    }
    expect(apiDockerfile).toContain(
      'CMD ["sh", "-c", "node apps/api/dist/scripts/migrate.js && node apps/api/dist/main.js"]'
    );
    expect(combinedEntrypoint).toContain(
      'node apps/api/dist/scripts/migrate.js'
    );
    expect(combinedEntrypoint).toContain('node apps/api/dist/main.js &');
    expect(productionCompose).toContain(
      'node apps/api/dist/scripts/migrate.js && node apps/api/dist/main.js'
    );
    expect(accountExportService).not.toContain(
      "import { Database } from 'bun:sqlite'"
    );
    expect(accountExportService).toContain("? 'bun:sqlite' : 'node:sqlite'");
    expect(accountExportService).toContain(
      'process.getBuiltinModule(sqliteModuleName)'
    );
  });
});
