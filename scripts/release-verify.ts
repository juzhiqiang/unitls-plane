const PRODUCTION_EMAIL_PATTERN =
  /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

/**
 * 单步命令。cwd 用 `Bun.spawn` 的 `cwd` 选项而不是 `bun --cwd=...` 命令行标志:
 * 后者在本机 Bun/Windows 下跑 openapi:export(Nest bootstrap 内 `process.exit(0)` +
 * Better-Auth/BullMQ 异步句柄)会异常退出 1,改成 spawn 选项才能稳定返回 0。
 */
interface CommandStep {
  command: string;
  args: readonly string[];
  cwd?: string;
}

const commands = [
  { command: 'bun', args: ['run', 'format:check:changed'] },
  { command: 'bun', args: ['run', 'lint'] },
  { command: 'bun', args: ['run', 'test:packages'] },
  { command: 'bun', args: ['run', 'test:api'] },
  { command: 'bun', args: ['run', 'test:web'] },
  { command: 'bun', args: ['run', 'openapi:export'], cwd: 'apps/api' },
  {
    command: 'bun',
    args: ['run', 'generate'],
    cwd: 'packages/api-client',
  },
  {
    command: 'git',
    args: [
      'diff',
      '--exit-code',
      '--',
      'apps/api/openapi.json',
      'packages/api-client/src/schema.ts',
    ],
  },
  { command: 'bun', args: ['run', 'build'] },
  { command: 'bunx', args: ['playwright', 'test'] },
] as const satisfies readonly CommandStep[];

function isValidProductionSupportEmail(email: string | undefined): boolean {
  const normalizedEmail = email?.trim() ?? '';
  const domain = normalizedEmail.split('@')[1]?.toLowerCase();

  return (
    PRODUCTION_EMAIL_PATTERN.test(normalizedEmail) &&
    !domain?.endsWith('.local')
  );
}

async function isWebDevServerRunning(): Promise<boolean> {
  try {
    await fetch('http://127.0.0.1:3000', {
      signal: AbortSignal.timeout(500),
    });
    return true;
  } catch {
    return false;
  }
}

if (!isValidProductionSupportEmail(process.env.NEXT_PUBLIC_SUPPORT_EMAIL)) {
  console.error(
    'NEXT_PUBLIC_SUPPORT_EMAIL must be a valid public email address in production.'
  );
  process.exit(1);
}

if (await isWebDevServerRunning()) {
  console.error('Stop the Web dev server before release verification');
  process.exit(1);
}

for (const [index, step] of commands.entries()) {
  console.log(
    `\n[${index + 1}/${commands.length}] ${step.command} ${step.args.join(' ')}${step.cwd ? ` (cwd: ${step.cwd})` : ''}`
  );

  const child = Bun.spawn([step.command, ...step.args], {
    stdout: 'inherit',
    stderr: 'inherit',
    ...(step.cwd ? { cwd: step.cwd } : {}),
  });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
