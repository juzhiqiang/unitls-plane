const PRODUCTION_EMAIL_PATTERN =
  /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

const envFileName = '.env.prod';

async function readEnvFileValue(name: string): Promise<string | undefined> {
  const envFile = Bun.file(envFileName);

  if (!(await envFile.exists())) {
    return undefined;
  }

  const source = await envFile.text();
  for (const line of source.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    if (key !== name) {
      continue;
    }

    return trimmedLine
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  return undefined;
}

function isValidProductionSupportEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();

  return PRODUCTION_EMAIL_PATTERN.test(email) && !domain?.endsWith('.local');
}

async function run(command: string, args: string[]): Promise<void> {
  console.log(`\n> ${command} ${args.join(' ')}`);

  const child = Bun.spawn([command, ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

const supportEmail =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ||
  (await readEnvFileValue('NEXT_PUBLIC_SUPPORT_EMAIL'))?.trim();

if (!supportEmail || !isValidProductionSupportEmail(supportEmail)) {
  console.error(
    `NEXT_PUBLIC_SUPPORT_EMAIL must be set to a valid public email address in the shell or ${envFileName}.`
  );
  process.exit(1);
}

await run('docker', [
  'build',
  '--build-arg',
  'NEXT_PUBLIC_API_URL=http://202.104.149.204:5006',
  '--build-arg',
  'NEXT_PUBLIC_S3_PUBLIC_URL=http://202.104.149.204:5009',
  '--build-arg',
  'NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=true',
  '--build-arg',
  'NEXT_PUBLIC_RELEASE=prod',
  '--build-arg',
  'NEXT_PUBLIC_APP_URL=http://202.104.149.204:5005',
  '--build-arg',
  `NEXT_PUBLIC_SUPPORT_EMAIL=${supportEmail}`,
  '-t',
  'utils-plane:all',
  '-f',
  'Dockerfile',
  '.',
]);

await run('docker', [
  'save',
  'utils-plane:all',
  'postgres:16-alpine',
  'redis:7-alpine',
  'minio/minio:latest',
  'minio/mc:latest',
  '-o',
  'utils-plane-offline-all.tar',
]);
