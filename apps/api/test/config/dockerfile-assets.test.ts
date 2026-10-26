import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const repoRoot = join(import.meta.dir, '../../../..');

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

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
    const combinedDockerfile = readRepoFile('Dockerfile');
    const apiDockerfile = readRepoFile('apps/api/Dockerfile');
    const combinedEntrypoint = readRepoFile('docker/start-all.sh');
    const productionCompose = readRepoFile('docker-compose.prod.yml');
    const accountExportService = readRepoFile(
      'apps/api/src/modules/account/account-export.service.ts'
    );

    for (const source of [combinedDockerfile, apiDockerfile]) {
      expect(source).not.toContain(
        'COPY --from=base /usr/local/bin/bun /usr/local/bin/bun'
      );
      expect(source).not.toContain('cp -RL apps/api/node_modules');
    }
    expect(apiDockerfile).toContain(
      'CMD ["sh", "-c", "node apps/api/dist/scripts/migrate.js && exec node apps/api/dist/main.js"]'
    );
    expect(apiDockerfile).toContain('ENV PROCESS_ROLE=api');
    expect(combinedEntrypoint).toContain(
      'node apps/api/dist/scripts/migrate.js'
    );
    expect(combinedEntrypoint).toContain(
      'PROCESS_ROLE=api node apps/api/dist/main.js &'
    );
    // 生产 compose 允许在 migrate 与 main 之间插入其它 node 启动脚本
    // (当前是 sync-id-photo-models),但顺序必须是 migrate 最先、main 最后,
    // 且全部走 node 而不是 bun。
    expect(productionCompose).toMatch(
      /node apps\/api\/dist\/scripts\/migrate\.js( && node apps\/api\/dist\/scripts\/[\w-]+\.js)* && exec node apps\/api\/dist\/main\.js/
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

describe('production process layout', () => {
  it('starts API and worker with readiness gating and graceful shutdown', () => {
    const compose = readRepoFile('docker-compose.prod.yml');

    expect(compose).toContain('x-api-environment: &api-environment');
    expect(compose).toMatch(/api:\s*\n(?:.*\n)*?\s+PROCESS_ROLE: api/);
    expect(compose).toMatch(/worker:\s*\n(?:.*\n)*?\s+PROCESS_ROLE: worker/);
    expect(compose).toContain('condition: service_healthy');
    expect(compose).toContain('stop_grace_period: 60s');
    expect(compose).toContain("fetch('http://127.0.0.1:3001/health/ready')");
    expect(compose).not.toMatch(
      /worker:\s*\n(?:.*\n)*?\s+node apps\/api\/dist\/scripts\/migrate\.js/
    );
  });

  it('keeps the worker out of the HTTP surface', () => {
    const compose = readRepoFile('docker-compose.prod.yml');
    const workerSection = compose
      .split(/^ {2}worker:\s*$/m)[1]
      ?.split(/^ {2}[a-z][a-z0-9-]*:\s*$/m)[0];

    expect(workerSection).toBeDefined();
    expect(workerSection).toContain(
      "command: ['node', 'apps/api/dist/main.js']"
    );
    expect(workerSection).not.toContain('ports:');
    expect(workerSection).not.toContain('healthcheck:');
    expect(workerSection).toContain('stop_grace_period: 60s');
    expect(workerSection).toContain('init: true');
    expect(workerSection).toContain(
      'WORKER_API_READY_URL: http://api:3001/health/ready'
    );
  });

  it('starts and stops all three offline processes together', () => {
    const entrypoint = readRepoFile('docker/start-all.sh');

    expect(entrypoint).toContain(
      'PROCESS_ROLE=api node apps/api/dist/main.js &'
    );
    expect(entrypoint).toContain(
      'PROCESS_ROLE=worker node apps/api/dist/main.js &'
    );
    expect(entrypoint).toContain("fetch('http://127.0.0.1:'");
    expect(entrypoint).toContain('api_pid');
    expect(entrypoint).toContain('worker_pid');
    expect(entrypoint).toContain('web_pid');
    expect(entrypoint).toContain('if [ "$status" -eq 0 ]; then');
    expect(entrypoint).toContain('status=1');
    expect(entrypoint).toContain('terminate "$status"');
    expect(
      entrypoint.match(/node apps\/api\/dist\/scripts\/migrate\.js/g)
    ).toHaveLength(1);
    expect(
      entrypoint.match(
        /node apps\/api\/dist\/scripts\/seed-image-generate-presets\.js/g
      )
    ).toHaveLength(1);
  });
});
