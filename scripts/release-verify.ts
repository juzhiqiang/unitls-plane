const PRODUCTION_EMAIL_PATTERN =
  /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

const commands = [
  ['bun', ['run', 'format:check:changed']],
  ['bun', ['run', 'lint']],
  ['bun', ['run', 'test:packages']],
  ['bun', ['run', 'test:api']],
  ['bun', ['run', 'test:web']],
  ['bun', ['--cwd=apps/api', 'run', 'openapi:export']],
  ['bun', ['--cwd=packages/api-client', 'run', 'generate']],
  [
    'git',
    [
      'diff',
      '--exit-code',
      '--',
      'apps/api/openapi.json',
      'packages/api-client/src/schema.ts',
    ],
  ],
  ['bun', ['run', 'build']],
  ['bunx', ['playwright', 'test']],
] as const;

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

for (const [index, [command, args]] of commands.entries()) {
  console.log(
    `\n[${index + 1}/${commands.length}] ${command} ${args.join(' ')}`
  );

  const child = Bun.spawn([command, ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
