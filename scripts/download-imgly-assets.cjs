// 从 @imgly CDN 下载证件照本地抠图所需的 ISNet 资产,落到 docker/models/imgly/1.7.0/dist/。
//
// @imgly/background-removal 的资产是分块的:resources.json 清单 + 若干按 SHA256 命名的分块文件。
// 运行时 loader 先取 resources.json,再按清单里每个资源的 chunks[].name(SHA256)逐块拉取,
// 校验 blob.size === offsets[1]-offsets[0] 后拼接还原资源。所以本地只需把这些"分块文件 +
// resources.json"原样上传到 MinIO,loader 即可按 publicPath 取用。
//
// 仅下载本地档位需要的 6 个资源键(跳过 isnet_quint8 极速档,本平台不提供):
//   运行时(4):ort-wasm-simd-threaded.{jsep.wasm, wasm, jsep.mjs, mjs}
//   均衡(1):/models/isnet_fp16
//   高精度(1):/models/isnet
//
// 资源键必须与 apps/web/src/lib/id-photo-local/model-registry.ts 的档位映射保持一致。
// 用法: node scripts/download-imgly-assets.cjs [runtime|isnet_fp16|isnet|all]
const fs = require('fs');
const path = require('path');

const VERSION = '1.7.0';
const CDN = `https://staticimgly.com/@imgly/background-removal-data/${VERSION}/dist/`;
// 落到 docker/models/imgly/<版本>/dist/,与 Dockerfile COPY docker/models/ ./models/id-photo/ 对齐,
// 镜像内即 /app/models/id-photo/imgly/<版本>/dist/。
const STAGE = path.join(__dirname, '..', 'docker', 'models', 'imgly', VERSION, 'dist');

const RESOURCES = {
  runtime: [
    '/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm',
    '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
    '/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs',
    '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
  ],
  isnet_fp16: ['/models/isnet_fp16'],
  isnet: ['/models/isnet'],
};

const which = process.argv[2] || 'all';
const keys =
  which === 'all'
    ? [...RESOURCES.runtime, ...RESOURCES.isnet_fp16, ...RESOURCES.isnet]
    : RESOURCES[which] || [];

if (keys.length === 0) {
  console.error(`unknown target: ${which} (expected runtime|isnet_fp16|isnet|all)`);
  process.exit(2);
}

fs.mkdirSync(STAGE, { recursive: true });

// resources.json 是清单,每次都重新拉取(版本可能升级)
async function fetchJson() {
  const res = await fetch(CDN + 'resources.json');
  if (!res.ok) throw new Error(`resources.json ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(path.join(STAGE, 'resources.json'), text);
  console.log(`resources.json saved (${text.length} B)`);
  return JSON.parse(text);
}

async function fetchChunk(name, expectedSize) {
  const out = path.join(STAGE, name);
  if (fs.existsSync(out) && fs.statSync(out).size === expectedSize) {
    return { cached: true };
  }
  const res = await fetch(CDN + name);
  if (!res.ok) throw new Error(`chunk ${name} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== expectedSize) {
    throw new Error(`chunk ${name} size ${buf.length} != expected ${expectedSize}`);
  }
  fs.writeFileSync(out, buf);
  return { cached: false };
}

async function downloadResource(manifest, key) {
  const entry = manifest[key];
  if (!entry) throw new Error(`key ${key} not in manifest`);
  const chunks = entry.chunks;
  let done = 0;
  for (const c of chunks) {
    const size = c.offsets[1] - c.offsets[0];
    const r = await fetchChunk(c.name, size);
    done++;
    console.log(
      `  ${key}  [${done}/${chunks.length}] ${(size / 1048576).toFixed(1)}MB ${r.cached ? '(cached)' : ''}`,
    );
  }
}

(async () => {
  const manifest = await fetchJson();
  console.log(`Downloading ${keys.length} resource(s) [${which}] → ${STAGE}`);
  for (const k of keys) {
    console.log(`== ${k}`);
    await downloadResource(manifest, k);
  }
  // 校验:每个键的分块是否齐全且尺寸正确
  let ok = true;
  let totalFiles = 0;
  let totalBytes = 0;
  for (const k of keys) {
    const e = manifest[k];
    for (const c of e.chunks) {
      const p = path.join(STAGE, c.name);
      const expected = c.offsets[1] - c.offsets[0];
      if (!fs.existsSync(p) || fs.statSync(p).size !== expected) {
        console.error(`MISSING/BAD chunk ${c.name} for ${k}`);
        ok = false;
      } else {
        totalFiles++;
        totalBytes += expected;
      }
    }
  }
  console.log(
    `\nDone. ${totalFiles} chunks, ${(totalBytes / 1048576).toFixed(1)}MB. resources.json present. ok=${ok}`,
  );
  if (!ok) process.exit(1);
})().catch(e => {
  console.error('ERR', e.message);
  process.exit(1);
});
