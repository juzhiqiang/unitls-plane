const GENERATED_FILES = new Set([
  'apps/api/openapi.json',
  'packages/api-client/src/schema.ts',
]);

async function runGit(args: string[]): Promise<Uint8Array> {
  const child = Bun.spawn(['git', ...args], {
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const outputPromise = new Response(child.stdout).arrayBuffer();
  const [exitCode, output] = await Promise.all([child.exited, outputPromise]);

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  return new Uint8Array(output);
}

function parseNullSeparatedPaths(output: Uint8Array): string[] {
  return new TextDecoder().decode(output).split('\0').filter(Boolean);
}

const baseRef = process.env.FORMAT_CHECK_BASE?.trim() || 'main';
const mergeBaseOutput = await runGit(['merge-base', baseRef, 'HEAD']);
const mergeBase = new TextDecoder().decode(mergeBaseOutput).trim();

if (!mergeBase) {
  console.error(`Unable to determine merge base for ${baseRef}`);
  process.exit(1);
}

const committedPaths = parseNullSeparatedPaths(
  await runGit([
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    '-z',
    `${mergeBase}...HEAD`,
  ])
);
const stagedPaths = parseNullSeparatedPaths(
  await runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
);
const unstagedPaths = parseNullSeparatedPaths(
  await runGit(['diff', '--name-only', '--diff-filter=ACMR', '-z'])
);
const untrackedPaths = parseNullSeparatedPaths(
  await runGit(['ls-files', '--others', '--exclude-standard', '-z'])
);
const unstagedPathSet = new Set(
  unstagedPaths.filter(path => !GENERATED_FILES.has(path))
);
const partiallyStagedPaths = stagedPaths
  .filter(path => !GENERATED_FILES.has(path) && unstagedPathSet.has(path))
  .sort();

if (partiallyStagedPaths.length > 0) {
  console.error(
    'Cannot check formatting for files with different staged and working tree contents:'
  );
  for (const path of partiallyStagedPaths) {
    console.error(`  ${path}`);
  }
  console.error(
    'Stage or restore these files so Prettier validates the exact content being committed.'
  );
  process.exit(1);
}

const changedPaths = [
  ...new Set([
    ...committedPaths,
    ...stagedPaths,
    ...unstagedPaths,
    ...untrackedPaths,
  ]),
]
  .filter(path => !GENERATED_FILES.has(path))
  .sort();

if (changedPaths.length === 0) {
  console.log('No changed files to check with Prettier.');
  process.exit(0);
}

console.log(`Checking formatting for ${changedPaths.length} changed files...`);

const prettier = Bun.spawn(
  ['bunx', 'prettier', '--check', '--ignore-unknown', '--', ...changedPaths],
  {
    stdout: 'inherit',
    stderr: 'inherit',
  }
);

process.exit(await prettier.exited);
