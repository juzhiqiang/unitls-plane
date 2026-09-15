import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../../..');

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

const documentationPaths = [
  'README.md',
  'PROJECT_SPECS.md',
  'CLAUDE.md',
  'docs/docker-offline-deployment.md',
] as const;

describe('public beta release documentation', () => {
  it('keeps the environment template telemetry-free and release-aware', () => {
    const source = readRepoFile('.env.example');

    expect(source).toContain('NEXT_PUBLIC_APP_URL=http://localhost:3000');
    expect(source).toContain('NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com');
    expect(source).toContain('RELEASE=dev');
    expect(source).toContain('BUILD_COMMIT=dev');
    expect(source).toContain('BUILD_TIME=');
    expect(source).not.toContain('ERROR_TRACKER');
  });

  it('publishes release metadata from the production API container', () => {
    const source = readRepoFile('docker-compose.prod.yml');

    expect(source).toContain('RELEASE: ${RELEASE:-prod}');
    expect(source).toContain('BUILD_COMMIT: ${BUILD_COMMIT:-unknown}');
    expect(source).toContain('BUILD_TIME: ${BUILD_TIME:-}');
    expect(source).toContain('mc anonymous set download local/uploads');
    expect(source).toContain('S3_ACCESS_KEY: ${S3_ACCESS_KEY:-minioadmin}');
    expect(source).toContain('S3_SECRET_KEY: ${S3_SECRET_KEY:-minioadmin}');
    expect(source).toContain(
      '# 使用方式: docker compose -f docker-compose.prod.yml --env-file .env.prod up -d'
    );
    expect(source).not.toContain(
      'docker compose -f docker-compose.yml -f docker-compose.prod.yml'
    );
  });

  it('defines retention and telemetry policy in the project specification', () => {
    const source = readRepoFile('PROJECT_SPECS.md');

    expect(source).toContain('匿名文件保留 24 小时');
    expect(source).toContain('回收站文件保留 30 天');
    expect(source).toContain('当前不启用遥测');
  });

  it('calls out the deployment risks that remain during the HTTP beta', () => {
    const source = readRepoFile('docs/docker-offline-deployment.md');

    expect(source).toContain('HTTP 受限公测');
    expect(source).toContain('匿名桶');
    expect(source).toContain('默认凭据');
    expect(source).toContain('公开任务状态');

    for (const path of [
      'README.md',
      'docs/docker-offline-deployment.md',
    ] as const) {
      const deploymentGuide = readRepoFile(path);
      const normalizedGuide = deploymentGuide.replace(/\s+/g, ' ');

      expect(deploymentGuide).toContain('RELEASE=prod');
      expect(deploymentGuide).toMatch(/BUILD_COMMIT=<[^>\r\n]+>/);
      expect(deploymentGuide).toMatch(/BUILD_TIME=<[^>\r\n]+>/);
      expect(normalizedGuide).toContain(
        '`docker run --env-file .env.prod` 必须在 `.env.prod` 中显式提供 `RELEASE`、`BUILD_COMMIT` 和 `BUILD_TIME`'
      );
      expect(normalizedGuide).toContain(
        '只有 Compose 部署会使用 `prod`、`unknown` 和空字符串默认值'
      );
    }
  });

  it.each(documentationPaths)(
    '%s uses the same public beta product and risk boundaries',
    path => {
      const source = readRepoFile(path);
      const normalizedSource = source.replace(/\s+/g, ' ');

      for (const statement of [
        '免费受限公测',
        '登录增强能力',
        '当前不启用遥测',
        '匿名文件保留 24 小时后永久删除',
        '回收站文件保留 30 天后永久删除',
        '账号数据可导出为 ZIP',
        '注销账号会立即永久删除账号及其文件和任务记录',
        '`/health/live` 仅检查进程状态和版本信息',
        '`/health/ready` 检查 PostgreSQL、Redis、MinIO、四个任务队列和 LibreOffice',
        '支持邮箱必须是可从公网联系的有效地址，且不能使用 `.local` 域名',
        'IP + HTTP',
        '默认凭据',
        '匿名桶',
        '公开任务状态',
        '不得称为安全的公网正式生产版',
      ]) {
        expect(normalizedSource, `${path} is missing: ${statement}`).toContain(
          statement
        );
      }

      expect(normalizedSource).toContain('分析、错误追踪或会话回放');
      expect(normalizedSource).toContain('NEXT_PUBLIC_APP_URL');
      expect(normalizedSource).toContain('NEXT_PUBLIC_SUPPORT_EMAIL');
      expect(normalizedSource).toContain('release:verify');
      expect(source).not.toContain('Error Tracker SDK');
      expect(source).not.toContain('../error-tracker/packages/sdk');
      expect(source).not.toContain('额外 build context');
      expect(source).not.toContain('额外构建上下文');
    }
  );
});
