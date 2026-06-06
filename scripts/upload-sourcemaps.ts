import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const api = process.env.ERROR_TRACKER_API ?? 'http://localhost:3002';
const projectId = process.env.ERROR_TRACKER_PROJECT_ID;
const token = process.env.ERROR_TRACKER_TOKEN;
const release = process.env.NEXT_PUBLIC_RELEASE ?? process.env.RELEASE ?? 'dev';
const buildDir = resolve(process.cwd(), 'apps/web/.next/static');

if (!projectId) {
  console.error('ERROR_TRACKER_PROJECT_ID env var is required');
  process.exit(1);
}

if (!token) {
  console.error('ERROR_TRACKER_TOKEN env var is required');
  process.exit(1);
}

if (!existsSync(buildDir)) {
  console.error(`Build directory not found: ${buildDir}`);
  console.error('Run apps/web build before uploading sourcemaps.');
  process.exit(1);
}

async function uploadSourceMaps() {
  const files = (await listFiles(buildDir)).filter((file) => file.endsWith('.map')).sort();
  console.log(`Uploading ${files.length} source maps for release ${release}`);

  if (files.length === 0) {
    console.log('No source maps found.');
    return;
  }

  const form = new FormData();
  const checksums: Array<{ filename: string; checksum: string }> = [];

  for (const file of files) {
    const content = await readFile(file);
    const filename = relative(buildDir, file).replace(/\\/g, '/');
    const checksum = sha256(content);
    checksums.push({ filename, checksum });
    form.append('files', new File([new Uint8Array(content)], filename, { type: 'application/json' }));
  }
  form.append('checksums', JSON.stringify(checksums));

  const response = await fetch(
    `${api.replace(/\/$/, '')}/api/sourcemaps/${encodeURIComponent(projectId)}/${encodeURIComponent(release)}/ci`,
    {
      method: 'POST',
      headers: { 'x-error-tracker-token': token },
      body: form,
    }
  );

  if (!response.ok) {
    throw new Error(`Sourcemap upload failed with ${response.status}: ${await response.text()}`);
  }

  const result = (await response.json()) as { uploaded: number };
  console.log(`Uploaded ${result.uploaded} source maps.`);
}

uploadSourceMaps();

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(dir, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    })
  );
  return nested.flat();
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
