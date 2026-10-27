// 手工验收工具：只在独立的本地 Docker 验证环境中运行，结果写入 log/。
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../..');
const req = createRequire(join(root, 'apps/api/package.json'));
const postgresModule = req('postgres');
const postgres = postgresModule.default || postgresModule;
const { Queue } = req('bullmq');
const sharp = req('sharp');
const { PDFDocument, StandardFonts, rgb } = req('pdf-lib');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prefix = 'perf-api-worker-acceptance';
const db = postgres('postgresql://utils:utils@127.0.0.1:55439/utils_plane', {
  max: 5,
});
const queues = ['setup', 'cleanup'].includes(process.argv[2])
  ? {}
  : Object.fromEntries(
      ['image', 'pdf', 'font', 'ai', 'cleanup'].map(k => [
        k,
        new Queue(k + '-queue', {
          connection: { host: '127.0.0.1', port: 62203 },
        }),
      ])
    );
for (const q of Object.values(queues)) q.on('error', () => {});
const artifacts = resolve(
  process.env.VALIDATION_ARTIFACTS || join(root, 'log/api-worker-acceptance')
);
fs.mkdirSync(artifacts, { recursive: true });
const runId =
  process.env.VALIDATION_RUN_ID ||
  new Date().toISOString().replace(/[:.]/g, '-');
const resultDir = join(artifacts, 'runs', runId);
fs.mkdirSync(resultDir, { recursive: true });
fs.copyFileSync(
  join(__dirname, 'api-worker-telemetry.cjs'),
  join(artifacts, 'telemetry.cjs')
);
const docker = (...args) =>
  execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const dockerAsync = (...args) =>
  new Promise((resolve, reject) => {
    const p = spawn('docker', args, { cwd: root, windowsHide: true });
    let out = '',
      err = '';
    p.stdout.on('data', b => (out += b));
    p.stderr.on('data', b => (err += b));
    p.on('error', reject);
    p.on('exit', code =>
      code === 0 ? resolve(out.trim()) : reject(Error(err || out))
    );
  });
const secretPath = join(artifacts, 'auth-secret');
if (!fs.existsSync(secretPath)) {
  const openssl =
    process.env.VALIDATION_OPENSSL ||
    (process.platform === 'win32'
      ? 'C:/Program Files/Git/usr/bin/openssl.exe'
      : 'openssl');
  fs.writeFileSync(
    secretPath,
    execFileSync(openssl, ['rand', '-base64', '32'], {
      encoding: 'utf8',
    }).trim(),
    { mode: 0o600 }
  );
}
const env = {
  DATABASE_URL: `postgresql://utils:utils@${prefix}-pg:5432/utils_plane`,
  REDIS_URL: `redis://${prefix}-redis:6379`,
  S3_ENDPOINT: `http://${prefix}-minio:9000`,
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'acceptance',
  S3_SECRET_KEY: 'LocalAcceptanceOnly1027',
  S3_BUCKET: 'uploads',
  S3_FORCE_PATH_STYLE: 'true',
  BETTER_AUTH_SECRET: fs.readFileSync(secretPath, 'utf8').trim(),
  BETTER_AUTH_URL: 'http://localhost:53101',
  REQUIRE_EMAIL_VERIFICATION: 'false',
  SMTP_HOST: 'localhost',
  SMTP_USER: 'validation',
  SMTP_PASSWORD: 'validation',
  SMTP_FROM: 'validation@example.com',
  NODE_ENV: 'production',
  SWAGGER_ENABLED: 'false',
  AI_IMAGE_BASE_URL: 'http://host.docker.internal:53109/v1',
  AI_IMAGE_MODEL: 'acceptance-local',
  AI_IMAGE_REQUEST_TIMEOUT_MS: '180000',
};
const longDelayMs = Number(process.env.VALIDATION_AI_DELAY_MS || 175000);
if (process.argv[2] === 'shutdown') {
  assert.ok(longDelayMs >= 1000 && longDelayMs <= 595000);
  env.AI_IMAGE_REQUEST_TIMEOUT_MS = String(
    Math.min(600000, Math.max(180000, longDelayMs + 5000))
  );
}
fs.writeFileSync(
  join(artifacts, 'runtime.env'),
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
);
let providerCalls = [];
const startedContainers = new Set();
let png;
const provider = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  if (request.url === '/state') {
    response.end(JSON.stringify(providerCalls));
    return;
  }
  const data = JSON.parse(body || '{}');
  const delay = Number(String(data.prompt).match(/delay-(\d+)/)?.[1] || 1200);
  const call = { started: Date.now(), delay, prompt: data.prompt };
  providerCalls.push(call);
  // 长任务用持续传输合法 JSON 空白保持连接，单独验证应用总超时与关闭等待。
  // Node fetch 的 headers/body 空闲超时独立于 AbortSignal 总超时；静默等待另记失败证据。
  let heartbeat;
  if (delay > 180000) {
    response.setHeader('content-type', 'application/json');
    response.write(' ');
    heartbeat = setInterval(() => response.write(' '), 30000);
  }
  await sleep(delay);
  if (heartbeat) clearInterval(heartbeat);
  call.finished = Date.now();
  if (!response.headersSent)
    response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })
  );
});
let cookie;
let inputs;
let benchmarkOwner;
async function json(path, init = {}) {
  const r = await fetch('http://localhost:53101' + path, {
    ...init,
    headers: { ...(cookie ? { cookie } : {}), ...init.headers },
    signal: AbortSignal.timeout(60000),
  });
  assert.ok(r.ok, `${path} ${r.status} ${await r.clone().text()}`);
  return r.json();
}
async function ready() {
  for (let i = 0; i < 160; i++) {
    try {
      if (
        (
          await fetch('http://localhost:53101/health/ready', {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        return;
    } catch {}
    await sleep(250);
  }
  throw Error('API not ready');
}
function mounts(dist) {
  return [
    '--mount',
    `type=bind,source=${dist},target=/app/apps/api/dist,readonly`,
    '--mount',
    `type=bind,source=${artifacts},target=/validation`,
  ];
}
function start(name, role, baseline = false) {
  const started = Date.now();
  const dist = baseline
    ? join(artifacts, 'baseline-source/apps/api/dist')
    : join(root, 'apps/api/dist');
  const flags = [
    'run',
    '-d',
    '--init',
    '--label',
    'utils-plane.validation=api-worker',
    '--name',
    `${prefix}-${name}`,
    '--network',
    prefix,
    '--env-file',
    join(artifacts, 'runtime.env'),
    '--memory',
    role === 'api' ? '512m' : role === 'worker' ? '1536m' : '2048m',
    '--cpus',
    role === 'api' ? '0.5' : role === 'worker' ? '1.5' : '2',
    '-e',
    `VALIDATION_METRICS=/validation/${name}-metrics.jsonl`,
    ...(baseline
      ? mounts(dist)
      : ['--mount', `type=bind,source=${artifacts},target=/validation`]),
  ];
  if (role !== 'worker') flags.push('-p', '127.0.0.1:53101:3001');
  if (role !== 'default') flags.push('-e', `PROCESS_ROLE=${role}`);
  if (name === 'monitored')
    flags.push(
      '-e',
      `WORKER_API_READY_URL=http://${prefix}-api:3001/health/ready`
    );
  if (process.argv[2] === 'auth')
    flags.push('-e', 'VALIDATION_COUNT_SESSIONS=true');
  flags.push(
    '--entrypoint',
    'node',
    process.env.VALIDATION_IMAGE || 'perf-api-worker:validation',
    '--require',
    '/validation/telemetry.cjs',
    'apps/api/dist/main.js'
  );
  fs.writeFileSync(join(artifacts, name + '-metrics.jsonl'), '');
  docker(...flags);
  startedContainers.add(name);
  return started;
}
async function stop(name, timeout = 30) {
  const n = `${prefix}-${name}`;
  try {
    await dockerAsync('stop', '--timeout', String(timeout), n);
    fs.writeFileSync(join(artifacts, name + '.log'), docker('logs', n));
    const state = JSON.parse(
      docker('inspect', '--format', '{{json .State}}', n)
    );
    fs.writeFileSync(
      join(resultDir, name + '-exit.json'),
      JSON.stringify(state, null, 2)
    );
    assert.equal(state.OOMKilled, false, name + ' OOM killed');
    assert.ok(
      (name === 'monitored' ? [0, 1, 143] : [0, 143]).includes(state.ExitCode),
      name + ' unexpected exit ' + state.ExitCode
    );
    docker('rm', n);
    startedContainers.delete(name);
    return state;
  } catch (e) {
    if (String(e).includes('No such container')) return;
    throw e;
  }
}
async function initialize() {
  try {
    docker('network', 'inspect', prefix);
  } catch {
    docker('network', 'create', prefix);
  }
  docker(
    'run',
    '-d',
    '--label',
    'utils-plane.validation=api-worker',
    '--name',
    `${prefix}-pg`,
    '--network',
    prefix,
    '-p',
    '127.0.0.1:55439:5432',
    '-e',
    'POSTGRES_USER=utils',
    '-e',
    'POSTGRES_PASSWORD=utils',
    '-e',
    'POSTGRES_DB=utils_plane',
    'postgres:16-alpine',
    '-c',
    'shared_preload_libraries=pg_stat_statements'
  );
  docker(
    'run',
    '-d',
    '--label',
    'utils-plane.validation=api-worker',
    '--name',
    `${prefix}-redis`,
    '--network',
    prefix,
    '-p',
    '127.0.0.1:62203:6379',
    'redis:7-alpine',
    'redis-server',
    '--maxmemory-policy',
    'noeviction'
  );
  docker(
    'run',
    '-d',
    '--label',
    'utils-plane.validation=api-worker',
    '--name',
    `${prefix}-minio`,
    '--network',
    prefix,
    '-p',
    '127.0.0.1:59009:9000',
    '-e',
    'MINIO_ROOT_USER=acceptance',
    '-e',
    'MINIO_ROOT_PASSWORD=LocalAcceptanceOnly1027',
    'minio/minio:latest',
    'server',
    '/data'
  );
  for (let i = 0; i < 80; i++) {
    try {
      await db`select 1`;
      break;
    } catch {}
    await sleep(250);
  }
  await db`create extension if not exists pg_stat_statements`;
  docker(
    'run',
    '--rm',
    '--network',
    prefix,
    '--env-file',
    join(artifacts, 'runtime.env'),
    '--entrypoint',
    'node',
    process.env.VALIDATION_IMAGE || 'perf-api-worker:validation',
    'apps/api/dist/scripts/migrate.js'
  );
  const { S3Client, CreateBucketCommand } = req('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: 'http://127.0.0.1:59009',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  });
  for (let i = 0; i < 40; i++) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: 'uploads' }));
      break;
    } catch (e) {
      if (i === 39) throw e;
      await sleep(250);
    }
  }
  s3.destroy();
  console.log('isolated dependencies initialized');
}
async function login(email = 'acceptance@example.com') {
  const password = 'LocalAccept1027!!';
  let r = await fetch('http://localhost:53101/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:53101',
    },
    body: JSON.stringify({ name: 'acceptance', email, password }),
  });
  if (!r.ok)
    r = await fetch('http://localhost:53101/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:53101',
      },
      body: JSON.stringify({ email, password }),
    });
  assert.ok(r.ok, await r.clone().text());
  cookie = r.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ');
  await db`update "user" set plan='pro', role='admin', email_verified=true where email=${email}`;
}
async function upload(buffer, name, type) {
  const body = new FormData();
  body.set('file', new Blob([buffer], { type }), name);
  return json('/files/upload', { method: 'POST', body });
}
async function fixtures() {
  const image = await sharp({
    create: { width: 2400, height: 1800, channels: 3, background: '#879abc' },
  })
    .png()
    .toBuffer();
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 18; p++) {
    const page = doc.addPage([595, 842]);
    for (let y = 0; y < 60; y++)
      page.drawText(`Acceptance page ${p} row ${y}: CPU isolation benchmark.`, {
        x: 15,
        y: 820 - y * 13,
        size: 10,
        font,
        color: rgb(0.1, 0.2, 0.3),
      });
  }
  const pdf = Buffer.from(await doc.save());
  const fontPath = process.env.VALIDATION_FONT || 'C:/Windows/Fonts/arial.ttf';
  inputs = {
    image: (await upload(image, 'acceptance.png', 'image/png')).id,
    pdf: (await upload(pdf, 'acceptance.pdf', 'application/pdf')).id,
    font: (
      await upload(fs.readFileSync(fontPath), 'acceptance.ttf', 'font/ttf')
    ).id,
  };
  console.log('real image / 18-page PDF / TTF fixtures uploaded');
}
const payloads = () => ({
  image: {
    type: 'convert',
    inputFileIds: [inputs.image],
    inputConfig: { toFormat: 'webp' },
  },
  pdf: {
    type: 'pdf_to_image',
    inputFileIds: [inputs.pdf],
    inputConfig: { format: 'png', dpi: 150 },
  },
  font: {
    type: 'font_convert',
    inputFileIds: [inputs.font],
    inputConfig: { toFormat: 'woff2' },
  },
  ai: {
    type: 'image_generate',
    inputFileIds: [],
    inputConfig: {
      mode: 'text_to_image',
      prompt: 'acceptance delay-1200',
      size: '1024x1024',
    },
  },
});
async function submit(kind, overrides) {
  const payload = { ...payloads()[kind], ...overrides };
  if (process.argv[2] === 'benchmark') {
    if (!benchmarkOwner)
      [benchmarkOwner] =
        await db`select user_id as id from files where id=${inputs.image}`;
    const owner = benchmarkOwner;
    const id = crypto.randomUUID();
    const [task] =
      await db`insert into tasks (id,user_id,type,status,input_file_ids,input_config) values (${id},${owner.id},${payload.type},'pending',${db.json(payload.inputFileIds)},${db.json(payload.inputConfig)}) returning *`;
    await queues[kind].add(
      payload.type,
      { taskId: id },
      {
        jobId: id,
        delay: 1000,
        attempts: kind === 'ai' ? 2 : 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 50, age: 3600 },
        removeOnFail: { count: 200, age: 24 * 3600 },
      }
    );
    return task;
  }
  return json('/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
async function waitTask(id, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const [t] = await db`select * from tasks where id=${id}`;
    assert.notEqual(t.status, 'failed', `${id}: ${t.error_message}`);
    if (t.status === 'completed') return t;
    await sleep(150);
  }
  throw Error('Task timed out ' + id);
}
async function waitQueueTask(kind, id, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const job = await queues[kind].getJob(id);
    assert.ok(job, `Missing ${kind} job ${id}`);
    const state = await job.getState();
    assert.notEqual(state, 'failed', `${id}: ${job.failedReason}`);
    if (state === 'completed') {
      const finalizedJob = await queues[kind].getJob(id);
      if (!finalizedJob?.finishedOn) {
        await sleep(100);
        continue;
      }
      const [task] = await db`select * from tasks where id=${id}`;
      assert.equal(task.status, 'completed');
      assert.ok(finalizedJob.finishedOn);
      if (process.argv[2] !== 'benchmark')
        assert.equal(
          finalizedJob.attemptsMade,
          1,
          'Unexpected retry in success workload'
        );
      return task;
    }
    await sleep(100);
  }
  throw Error(`Measurement timeout: ${kind} ${id}`);
}
function unzipEntries(buffer) {
  // 仅解析本工具产生的普通 ZIP，中央目录给出压缩长度，兼容流式 data descriptor。
  const entries = [];
  for (let pos = 0; pos < buffer.length - 46; pos++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) continue;
    const method = buffer.readUInt16LE(pos + 10),
      size = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28),
      extraLength = buffer.readUInt16LE(pos + 30),
      commentLength = buffer.readUInt16LE(pos + 32);
    const offset = buffer.readUInt32LE(pos + 42),
      name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString();
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    const dataOffset =
      offset +
      30 +
      buffer.readUInt16LE(offset + 26) +
      buffer.readUInt16LE(offset + 28);
    const packed = buffer.subarray(dataOffset, dataOffset + size);
    entries.push({
      name,
      data: method === 0 ? packed : require('node:zlib').inflateRawSync(packed),
    });
    pos += 45 + nameLength + extraLength + commentLength;
  }
  return entries;
}
async function fiveQueues() {
  const results = {};
  for (const k of ['image', 'pdf', 'font', 'ai']) {
    const started = Date.now(),
      t = await submit(k);
    const done = await waitQueueTask(k, t.id);
    const [file] =
      await db`select * from files where id=${done.output_file_id}`;
    const { S3Client, GetObjectCommand } = req('@aws-sdk/client-s3');
    const s3 = new S3Client({
      endpoint: 'http://127.0.0.1:59009',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
    const content = Buffer.from(
      await (
        await s3.send(
          new GetObjectCommand({ Bucket: 'uploads', Key: file.storage_key })
        )
      ).Body.transformToByteArray()
    );
    s3.destroy();
    if (k === 'image' || k === 'ai') {
      const metadata = await sharp(content).metadata();
      assert.equal(metadata.format, k === 'image' ? 'webp' : 'png');
      assert.equal(metadata.width, k === 'image' ? 2400 : 128);
      assert.equal(metadata.height, k === 'image' ? 1800 : 128);
      assert.ok((await sharp(content).raw().toBuffer()).length > 0);
    }
    if (k === 'font') {
      const ttf = Buffer.from(await req('wawoff2').decompress(content));
      assert.ok(
        req('fonteditor-core').Font.create(ttf, { type: 'ttf' }).get().glyf
          .length > 0
      );
    }
    if (k === 'pdf') {
      const pages = unzipEntries(content);
      assert.equal(pages.length, 18);
      assert.deepEqual(
        pages.map(p => p.name).sort(),
        Array.from({ length: 18 }, (_, i) => `page-${i + 1}.png`).sort()
      );
      for (const page of pages) {
        assert.equal((await sharp(page.data).metadata()).format, 'png');
        assert.ok((await sharp(page.data).raw().toBuffer()).length > 0);
      }
    }
    results[k] = {
      task: t.id,
      ms: Date.now() - started,
      bytes: content.length,
    };
    console.log(k + ' real task and downloaded output verified');
  }
  const id = crypto.randomUUID(),
    key = `acceptance/orphan-${id}.txt`;
  const { S3Client, PutObjectCommand, HeadObjectCommand } =
    req('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: 'http://127.0.0.1:59009',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  });
  await s3.send(
    new PutObjectCommand({ Bucket: 'uploads', Key: key, Body: 'orphan' })
  );
  const job = await queues.cleanup.add(
    'delete-orphan-object',
    { fileId: id, storageKey: key },
    { jobId: id }
  );
  for (let i = 0; i < 100; i++) {
    if ((await job.getState()) === 'completed') break;
    await sleep(100);
  }
  assert.equal(await job.getState(), 'completed');
  let missing = false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: 'uploads', Key: key }));
  } catch (e) {
    missing = e.$metadata?.httpStatusCode === 404;
  }
  assert.ok(missing);
  s3.destroy();
  results.cleanup = { job: id, deleted: true };
  assert.equal((await queues.cleanup.getRepeatableJobs()).length, 2);
  fs.writeFileSync(
    join(artifacts, 'five-queues.json'),
    JSON.stringify(results, null, 2)
  );
  console.log(
    'five queues PASS; cleanup deleted actual S3 orphan; two schedulers'
  );
}
function stats(values) {
  const a = [...values].sort((x, y) => x - y);
  return {
    n: a.length,
    p50: a[Math.floor((a.length - 1) * 0.5)],
    p95: a[Math.floor((a.length - 1) * 0.95)],
    max: a.at(-1),
  };
}
async function benchmark(label, high) {
  const beforeState = await Promise.all(
    Object.entries(queues).map(async ([kind, q]) => ({
      kind,
      counts: await q.getJobCounts(
        'active',
        'waiting',
        'delayed',
        'failed',
        'completed'
      ),
    }))
  );
  assert.ok(
    beforeState.every(
      x =>
        x.counts.active === 0 &&
        (x.kind === 'cleanup' || x.counts.waiting + x.counts.delayed === 0)
    ),
    'Previous round has unfinished jobs'
  );
  const windowMs = Number(process.env.VALIDATION_WINDOW_MS || 24000);
  const started = Date.now(),
    end = started + windowMs;
  const jobs = [],
    failures = [],
    snapshots = [],
    responses = [],
    jobDetails = [];
  const producerKinds = [
    'image',
    'image',
    'pdf',
    'pdf',
    'font',
    'font',
    ...Array(8).fill('ai'),
  ];
  const producers = high
    ? producerKinds.map(async kind => {
        while (Date.now() < end) {
          try {
            const task = await submit(kind);
            const done = await waitQueueTask(kind, task.id);
            const j = await queues[kind].getJob(task.id);
            jobDetails.push({
              kind,
              taskId: task.id,
              jobId: j.id,
              state: await j.getState(),
              attemptsMade: j.attemptsMade,
              submittedOn: j.timestamp,
              processedOn: j.processedOn,
              finishedOn: j.finishedOn,
              finishedInWindow: j.finishedOn >= started && j.finishedOn <= end,
              outputFileId: done.output_file_id,
            });
          } catch (error) {
            failures.push({ kind, error: String(error) });
            break;
          }
        }
      })
    : [];
  const sampler = (async () => {
    const client = await queues.image.client;
    while (Date.now() < end) {
      const transaction = client.multi();
      for (const kind of ['image', 'pdf', 'font', 'ai'])
        transaction.llen(queues[kind].toKey('active'));
      const sizes = await transaction.exec();
      snapshots.push({
        time: Date.now(),
        active: Object.fromEntries(
          ['image', 'pdf', 'font', 'ai'].map((k, i) => [k, sizes[i][1]])
        ),
      });
      await sleep(100);
    }
  })();
  const intervalMs = 1000 / Number(process.env.VALIDATION_HTTP_RPS || 40);
  let scheduled = 0;
  while (Date.now() < end) {
    const due = started + scheduled * intervalMs;
    if (Date.now() < due) await sleep(due - Date.now());
    if (due >= end) break;
    scheduled++;
    jobs.push(
      (async () => {
        const sent = Date.now(),
          before = performance.now();
        try {
          const response = await fetch('http://localhost:53101/health/ready', {
            signal: AbortSignal.timeout(10000),
          });
          await response.arrayBuffer();
          responses.push({
            sent,
            schedulingLagMs: sent - due,
            status: response.status,
            latencyMs: performance.now() - before,
          });
        } catch (error) {
          responses.push({
            sent,
            schedulingLagMs: sent - due,
            status: 0,
            latencyMs: performance.now() - before,
            error: String(error),
          });
        }
      })()
    );
  }
  await Promise.all(jobs);
  await sampler;
  await Promise.all(producers);
  await sleep(1100);
  const name = label.startsWith('baseline') ? 'baseline' : 'api';
  const readFrames = name =>
    fs
      .readFileSync(join(artifacts, name + '-metrics.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
  const frames = readFrames(name),
    workerFrames = name === 'api' ? readFrames('worker') : [];
  const samples = frames.filter(x => x.time >= started && x.time <= end);
  const workerSamples = workerFrames.filter(
    x => x.time >= started && x.time <= end
  );
  const loopDelays = frames
    .flatMap(x => x.loopSamples || [])
    .filter(x => x[0] >= started && x[0] <= end)
    .map(x => x[1]);
  const successful = responses.filter(x => x.status >= 200 && x.status < 300),
    errors = responses.filter(x => x.status < 200 || x.status >= 300);
  const statusCounts = {};
  for (const item of responses)
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  const completedInWindow = Object.fromEntries(
    ['image', 'pdf', 'font', 'ai'].map(kind => [
      kind,
      jobDetails.filter(j => j.kind === kind && j.finishedInWindow).length,
    ])
  );
  const maxActive = Object.fromEntries(
    ['image', 'pdf', 'font', 'ai'].map(kind => [
      kind,
      Math.max(...snapshots.map(x => x.active[kind])),
    ])
  );
  const fullConcurrencySnapshots = snapshots.filter(
    x =>
      x.active.image === 2 &&
      x.active.pdf === 2 &&
      x.active.font === 2 &&
      x.active.ai === 8
  );
  const result = {
    label,
    started,
    end,
    windowMs,
    elapsedIncludingDrainMs: Date.now() - started,
    targetHttpRps: 1000 / intervalMs,
    actualOfferedRps: scheduled / (windowMs / 1000),
    responseCount: responses.length,
    successLatencyMs: stats(successful.map(x => x.latencyMs)),
    allResponseLatencyMs: stats(responses.map(x => x.latencyMs)),
    statusCounts,
    httpErrorRate: errors.length / responses.length,
    schedulingLagMs: stats(responses.map(x => x.schedulingLagMs)),
    completedInWindow,
    throughputPerSecond: Object.fromEntries(
      Object.entries(completedInWindow).map(([k, n]) => [
        k,
        n / (windowMs / 1000),
      ])
    ),
    completedIncludingDrain: jobDetails.length,
    retries: jobDetails.reduce(
      (sum, job) => sum + Math.max(0, job.attemptsMade - 1),
      0
    ),
    failures,
    queueWaitMs: stats(jobDetails.map(j => j.processedOn - j.submittedOn)),
    jobDetails,
    maxActive,
    fullConcurrencySnapshots: fullConcurrencySnapshots.length,
    concurrencySnapshots: snapshots,
    apiRssMB: stats(samples.map(x => x.rss / 1048576)),
    workerRssMB: stats(workerSamples.map(x => x.rss / 1048576)),
    rssSampleMaxGapMs: stats(
      samples.slice(1).map((x, i) => x.time - samples[i].time)
    ).max,
    loopSchedulingDelayMs: stats(loopDelays),
    beforeState,
  };
  fs.writeFileSync(
    join(resultDir, label + '.json'),
    JSON.stringify(result, null, 2)
  );
  fs.writeFileSync(
    join(resultDir, label + '-responses.json'),
    JSON.stringify(responses)
  );
  fs.writeFileSync(
    join(resultDir, label + '-metrics.json'),
    JSON.stringify({ api: frames, worker: workerFrames })
  );
  console.log(
    JSON.stringify({
      label,
      p95: result.successLatencyMs.p95,
      throughput: result.throughputPerSecond,
      failures: failures.length,
      statusCounts,
      rss: result.apiRssMB.p95,
    })
  );
  assert.equal(failures.length, 0, JSON.stringify(failures));
  if (name === 'api')
    assert.equal(errors.length, 0, 'Split API returned HTTP failures');
  return result;
}
async function main() {
  png = await sharp({
    create: { width: 128, height: 128, channels: 3, background: '#aabbcc' },
  })
    .png()
    .toBuffer();
  await new Promise(r => provider.listen(53109, '0.0.0.0', r));
  const mode = process.argv[2] || 'setup';
  if (mode === 'setup') {
    await initialize();
    return;
  }
  if (mode === 'functional') {
    start('api', 'api');
    await ready();
    await login(`acceptance-functional-${Date.now()}@example.com`);
    await fixtures();
    for (const queue of Object.values(queues))
      assert.equal((await queue.getWorkers()).length, 0);
    start('worker', 'worker');
    for (let i = 0; i < 100; i++) {
      if (
        (
          await Promise.all(Object.values(queues).map(q => q.getWorkers()))
        ).every(workers => workers.length === 1)
      )
        break;
      await sleep(100);
    }
    for (const queue of Object.values(queues))
      assert.equal((await queue.getWorkers()).length, 1);
    await fiveQueues();
    fs.writeFileSync(
      join(artifacts, 'inputs.json'),
      JSON.stringify({ cookie, inputs })
    );
    await stop('worker');
    await stop('api');
  }
  if (mode === 'benchmark') {
    ({ cookie, inputs } = JSON.parse(
      fs.readFileSync(join(artifacts, 'inputs.json'), 'utf8')
    ));
    const order =
      process.env.VALIDATION_ORDER || 'baseline,split,split,baseline';
    const results = [];
    const { createHash } = require('node:crypto');
    const sha = path =>
      createHash('sha256').update(fs.readFileSync(path)).digest('hex');
    const manifest = {
      runId,
      command: process.argv,
      date: new Date().toISOString(),
      baselineCommit: 'a582ca1',
      image: docker(
        'image',
        'inspect',
        '--format',
        '{{.Id}}',
        process.env.VALIDATION_IMAGE || 'perf-api-worker:validation'
      ),
      docker: docker(
        'info',
        '--format',
        '{{.ServerVersion}} {{.NCPU}} {{.MemTotal}}'
      ),
      scriptSha256: sha(__filename),
      telemetrySha256: sha(join(__dirname, 'api-worker-telemetry.cjs')),
      fontSha256: sha(
        process.env.VALIDATION_FONT || 'C:/Windows/Fonts/arial.ttf'
      ),
      baselineDistSha256: sha(
        join(artifacts, 'baseline-source/apps/api/dist/main.js')
      ),
      currentDistSha256: sha(join(root, 'apps/api/dist/main.js')),
      order,
      windowMs: Number(process.env.VALIDATION_WINDOW_MS || 24000),
      httpRps: Number(process.env.VALIDATION_HTTP_RPS || 40),
      baselineBudget: '2 CPU / 2048 MiB',
      splitBudget: 'API 0.5 CPU / 512 MiB + Worker 1.5 CPU / 1536 MiB',
      hostEpochMs: Date.now(),
      containerEpochMs: Number(
        docker(
          'run',
          '--rm',
          '--entrypoint',
          'node',
          process.env.VALIDATION_IMAGE || 'perf-api-worker:validation',
          '-e',
          'console.log(Date.now())'
        )
      ),
    };
    fs.writeFileSync(
      join(resultDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    fs.copyFileSync(__filename, join(resultDir, 'acceptance-frozen.cjs'));
    fs.copyFileSync(
      join(__dirname, 'api-worker-telemetry.cjs'),
      join(resultDir, 'telemetry-frozen.cjs')
    );
    for (const [index, layout] of order.split(',').entries()) {
      try {
        if (layout === 'baseline') start('baseline', 'all', true);
        else {
          start('api', 'api');
          await ready();
          start('worker', 'worker');
        }
        await ready();
        await sleep(1500);
        results.push(await benchmark(`${layout}-${index}-idle`, false));
        results.push(await benchmark(`${layout}-${index}-high`, true));
      } finally {
        if (layout === 'baseline') await stop('baseline', 900);
        else {
          await stop('worker', 900);
          await stop('api', 900);
        }
      }
    }
    fs.writeFileSync(
      join(resultDir, 'benchmark.json'),
      JSON.stringify(results, null, 2)
    );
  }
  if (mode === 'shutdown') {
    // 共享路径只供兼容读取，每轮正式证据独立归档，失败不得复用旧成功结果。
    fs.rmSync(join(artifacts, 'long-shutdown.json'), { force: true });
    const { createHash } = require('node:crypto');
    const sha = path =>
      createHash('sha256').update(fs.readFileSync(path)).digest('hex');
    fs.writeFileSync(
      join(resultDir, 'manifest.json'),
      JSON.stringify(
        {
          runId,
          mode,
          date: new Date().toISOString(),
          image: docker(
            'image',
            'inspect',
            '--format',
            '{{.Id}}',
            process.env.VALIDATION_IMAGE || 'perf-api-worker:validation'
          ),
          scriptSha256: sha(__filename),
          telemetrySha256: sha(join(__dirname, 'api-worker-telemetry.cjs')),
          providerDelayMs: longDelayMs,
          requestTimeoutMs: Number(env.AI_IMAGE_REQUEST_TIMEOUT_MS),
          stopTimeoutSeconds: 900,
          providerKeepaliveMs: longDelayMs > 180000 ? 30000 : null,
        },
        null,
        2
      )
    );
    fs.copyFileSync(__filename, join(resultDir, 'acceptance-frozen.cjs'));
    fs.copyFileSync(
      join(__dirname, 'api-worker-telemetry.cjs'),
      join(resultDir, 'telemetry-frozen.cjs')
    );
    ({ cookie, inputs } = JSON.parse(
      fs.readFileSync(join(artifacts, 'inputs.json'), 'utf8')
    ));
    start('api', 'api');
    await ready();
    await login(`acceptance-long-${Date.now()}@example.com`);
    await fixtures();
    start('worker', 'worker');
    const pdfSubmitted = Date.now();
    const pdf = await submit('pdf', {
      inputConfig: { format: 'png', dpi: 600 },
    });
    const trace = crypto.randomUUID();
    const task = await submit('ai', {
      inputConfig: {
        mode: 'text_to_image',
        prompt: `acceptance trace-${trace} delay-${longDelayMs}`,
        size: '1024x1024',
      },
    });
    let active = false;
    for (let i = 0; i < 200; i++) {
      const call = providerCalls.find(c => c.prompt.includes(trace));
      const [pdfJob, aiJob] = await Promise.all([
        queues.pdf.getJob(pdf.id),
        queues.ai.getJob(task.id),
      ]);
      if (
        call &&
        (await pdfJob.getState()) === 'active' &&
        (await aiJob.getState()) === 'active'
      ) {
        active = true;
        break;
      }
      await sleep(100);
    }
    assert.ok(active, 'Both specified jobs must be active before SIGTERM');
    const pdfFinishing = waitQueueTask('pdf', pdf.id, longDelayMs + 60000).then(
      done => ({
        task: done.id,
        status: done.status,
        elapsedMs: Date.now() - pdfSubmitted,
      })
    );
    const before = Date.now();
    const [pdfDone, done, state] = await Promise.all([
      pdfFinishing,
      waitQueueTask('ai', task.id, longDelayMs + 60000),
      stop('worker', 900),
    ]);
    const result = {
      task: done.id,
      status: done.status,
      pdf: pdfDone,
      elapsedAfterSigtermMs: Date.now() - before,
      exitCode: state.ExitCode,
      providerCalls,
      bothActiveAtSigterm: active,
      oomKilled: state.OOMKilled,
      upstreamTimeoutMs: Number(env.AI_IMAGE_REQUEST_TIMEOUT_MS),
    };
    const { S3Client, GetObjectCommand } = req('@aws-sdk/client-s3');
    const s3 = new S3Client({
      endpoint: 'http://127.0.0.1:59009',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
    for (const [kind, id] of [
      ['ai', task.id],
      ['pdf', pdf.id],
    ]) {
      const [output] =
        await db`select files.storage_key from files join tasks on files.id=tasks.output_file_id where tasks.id=${id}`;
      const content = Buffer.from(
        await (
          await s3.send(
            new GetObjectCommand({ Bucket: 'uploads', Key: output.storage_key })
          )
        ).Body.transformToByteArray()
      );
      if (kind === 'ai')
        assert.equal((await sharp(content).metadata()).width, 128);
      else {
        const pages = unzipEntries(content);
        assert.equal(pages.length, 18);
        for (const page of pages)
          assert.ok((await sharp(page.data).metadata()).width > 4900);
      }
    }
    s3.destroy();
    result.outputValidation =
      'AI PNG metadata read; 18 PDF PNG page headers parsed at 600 DPI';
    assert.equal(providerCalls.filter(c => c.prompt.includes(trace)).length, 1);
    assert.ok(result.elapsedAfterSigtermMs > longDelayMs - 5000);
    fs.writeFileSync(
      join(resultDir, 'long-shutdown.json'),
      JSON.stringify(result, null, 2)
    );
    fs.writeFileSync(
      join(artifacts, 'long-shutdown.json'),
      JSON.stringify(result, null, 2)
    );
    console.log(JSON.stringify(result));
    await stop('api');
  }
  if (mode === 'rollback') {
    ({ cookie, inputs } = JSON.parse(
      fs.readFileSync(join(artifacts, 'inputs.json'), 'utf8')
    ));
    start('api', 'api');
    await ready();
    assert.equal((await queues.image.getWorkers()).length, 0);
    const task = await submit('image');
    await sleep(1000);
    assert.ok(
      ['waiting', 'delayed'].includes(
        await (await queues.image.getJob(task.id)).getState()
      )
    );
    const [before] =
      await db`select count(*)::int as count from drizzle.__drizzle_migrations`;
    await stop('api');
    start('all', 'default');
    await ready();
    const done = await waitTask(task.id);
    const [after] =
      await db`select count(*)::int as count from drizzle.__drizzle_migrations`;
    assert.equal(after.count, before.count);
    assert.equal((await queues.image.getWorkers()).length, 1);
    assert.equal((await queues.cleanup.getRepeatableJobs()).length, 2);
    fs.writeFileSync(
      join(artifacts, 'rollback.json'),
      JSON.stringify(
        {
          task: done.id,
          status: done.status,
          migrationsBefore: before.count,
          migrationsAfter: after.count,
          defaultAllConsumers: 1,
        },
        null,
        2
      )
    );
    await stop('all');
    start('api', 'api');
    await ready();
    start('monitored', 'worker');
    for (let i = 0; i < 80; i++) {
      if ((await queues.image.getWorkers()).length) break;
      await sleep(100);
    }
    assert.equal((await queues.image.getWorkers()).length, 1);
    await stop('api');
    let state;
    for (let i = 0; i < 120; i++) {
      state = JSON.parse(
        docker('inspect', '--format', '{{json .State}}', `${prefix}-monitored`)
      );
      if (!state.Running) break;
      await sleep(100);
    }
    assert.equal(state.Running, false);
    assert.notEqual(state.ExitCode, 137);
    assert.equal((await queues.image.getWorkers()).length, 0);
    docker('start', `${prefix}-monitored`);
    for (let i = 0; i < 120; i++) {
      state = JSON.parse(
        docker('inspect', '--format', '{{json .State}}', `${prefix}-monitored`)
      );
      if (!state.Running) break;
      await sleep(100);
    }
    assert.equal(state.Running, false);
    assert.equal(state.ExitCode, 1);
    assert.equal((await queues.image.getWorkers()).length, 0);
    await stop('monitored');
    console.log(
      'rollback: queued task survived API-only -> default all; migrations unchanged; API failure drains worker; restart blocked without readiness'
    );
  }
  if (mode === 'auth') {
    ({ cookie, inputs } = JSON.parse(
      fs.readFileSync(join(artifacts, 'inputs.json'), 'utf8')
    ));
    const task = JSON.parse(
      fs.readFileSync(join(artifacts, 'five-queues.json'), 'utf8')
    ).image.task;
    const results = [];
    for (const baseline of [true, false]) {
      const name = baseline ? 'baseline' : 'api',
        t = start(name, baseline ? 'all' : 'api', baseline);
      await ready();
      const startupMs = Date.now() - t;
      await login(
        `acceptance-auth-${baseline ? 'baseline' : 'api'}-${Date.now()}@example.com`
      );
      await sleep(1100);
      const readMetrics = () =>
        fs
          .readFileSync(join(artifacts, name + '-metrics.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse)
          .at(-1);
      for (const credential of ['none', 'ordinary', 'session']) {
        const before = readMetrics().sessionCalls;
        await db`select pg_stat_statements_reset()`;
        const samples = [];
        for (let i = 0; i < 24; i++) {
          const t = performance.now();
          const r = await fetch(`http://localhost:53101/tasks/${task}/status`, {
            headers:
              credential === 'session'
                ? { cookie }
                : credential === 'ordinary'
                  ? { cookie: 'theme=dark' }
                  : {},
          });
          assert.equal(r.status, 200, await r.clone().text());
          await r.arrayBuffer();
          samples.push(performance.now() - t);
        }
        const [queries] =
          await db`select coalesce(sum(calls),0)::int as calls from pg_stat_statements where query like '%"session"%'`;
        await sleep(1100);
        results.push({
          layout: baseline ? 'D0' : 'split',
          credential,
          startupMs,
          sessionVerifications: readMetrics().sessionCalls - before,
          sessionSqlCalls: queries.calls,
          latencyMs: stats(samples),
        });
        assert.equal(
          results.at(-1).sessionVerifications,
          baseline || credential === 'session' ? 24 : 0
        );
        assert.equal(queries.calls, credential === 'session' ? 24 : 0);
      }
      await stop(name);
    }
    fs.writeFileSync(
      join(artifacts, 'auth.json'),
      JSON.stringify(results, null, 2)
    );
    console.log(JSON.stringify(results));
  }
  if (mode === 'capacity') {
    ({ cookie, inputs } = JSON.parse(
      fs.readFileSync(join(artifacts, 'inputs.json'), 'utf8')
    ));
    start('api', 'api');
    await ready();
    start('worker', 'worker');
    for (let i = 0; i < 80; i++) {
      if ((await queues.image.getWorkers()).length) break;
      await sleep(100);
    }
    const [pg] =
      await db`select current_setting('max_connections')::int as max_connections,current_setting('superuser_reserved_connections')::int as reserved,(select count(*)::int from pg_stat_activity) as connected`;
    const client = await queues.image.client,
      info = await client.info('clients');
    const redis = Object.fromEntries(
      info
        .split('\r\n')
        .filter(x => /^(connected_clients|maxclients|blocked_clients):/.test(x))
        .map(x => x.split(':'))
    );
    const result = {
      postgres: pg,
      redis,
      configuredAppPoolMax: 40,
      harnessPoolMax: 5,
    };
    assert.ok(40 + 5 < pg.max_connections - pg.reserved);
    assert.ok(Number(redis.connected_clients) < Number(redis.maxclients));
    fs.writeFileSync(
      join(artifacts, 'capacity.json'),
      JSON.stringify(result, null, 2)
    );
    console.log(JSON.stringify(result));
    await stop('worker');
    await stop('api');
  }
  if (mode === 'cleanup') {
    const names = docker(
      'ps',
      '-a',
      '--filter',
      'label=utils-plane.validation=api-worker',
      '--format',
      '{{.Names}}'
    )
      .split('\n')
      .filter(n => n.startsWith(prefix + '-'));
    for (const name of names) {
      try {
        await dockerAsync('stop', '--timeout', '900', name);
      } catch {}
      docker('rm', '--volumes', name);
    }
    docker('network', 'rm', prefix);
    console.log('removed only acceptance containers and network');
  }
}
main()
  .catch(e => {
    fs.writeFileSync(
      join(resultDir, 'failure.json'),
      JSON.stringify(
        { date: new Date().toISOString(), error: String(e) },
        null,
        2
      )
    );
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const name of [...startedContainers].reverse()) {
      try {
        await stop(name, 900);
      } catch (error) {
        console.error('Container cleanup failed', name, String(error));
      }
    }
    provider.close();
    provider.closeAllConnections();
    await Promise.all(Object.values(queues).map(q => q.close()));
    await db.end();
  });
