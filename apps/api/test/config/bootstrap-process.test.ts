import { spawn } from 'bun';
import { expect, it } from 'bun:test';
import { join } from 'node:path';

it('exits on invalid Swagger configuration before opening service connections', async () => {
  const child = spawn([process.execPath, 'src/main.ts'], {
    cwd: join(import.meta.dir, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PROCESS_ROLE: 'api',
      SWAGGER_ENABLED: 'invalid',
      REQUIRE_EMAIL_VERIFICATION: 'false',
      REDIS_URL: 'redis://127.0.0.1:1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 4000);
  try {
    const [code, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    expect(timedOut).toBe(false);
    expect(code).toBe(1);
    expect(stderr).toContain('SWAGGER_ENABLED');
    expect(stderr).not.toContain('ECONNREFUSED');
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}, 10000);

const failureFixture = `
import { mock } from 'bun:test';
import { Module } from '@nestjs/common';
import { throttleConfig } from './src/config/throttle.config';
class ApiAppModule {}
Module({ imports: [throttleConfig] })(ApiAppModule);
mock.module('./src/api-app.module', () => ({ ApiAppModule }));
mock.module('@utils-plane/auth', () => ({ isOriginAllowed: () => true }));
`;

for (const [name, fixture, marker] of [
  [
    'HTTP port collision',
    `
const net = await import('node:net');
const server = net.createServer();
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
process.env.PORT = String(server.address().port);
const error = console.error;
console.error = (...args) => { error(...args); if (String(args[0]).includes('[bootstrap]')) server.close(); };
await import('./src/main');
`,
    'EADDRINUSE',
  ],
  [
    'OpenAPI generation failure',
    `
const { SwaggerModule } = await import('@nestjs/swagger');
SwaggerModule.createDocument = () => { throw new Error('EXPORT_FAILURE_TEST'); };
await import('./src/scripts/export-openapi');
`,
    'EXPORT_FAILURE_TEST',
  ],
]) {
  it(`exits with failure after ${name} even with open Redis handles`, async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['-'], {
      input: failureFixture + fixture,
      cwd: join(import.meta.dir, '../..'),
      encoding: 'utf8',
      timeout: 4000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PROCESS_ROLE: 'api',
        SWAGGER_ENABLED: 'false',
        REQUIRE_EMAIL_VERIFICATION: 'false',
        REDIS_URL: 'redis://127.0.0.1:1',
      },
    });
    expect(result.stderr).toContain(marker);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
  }, 10000);
}
