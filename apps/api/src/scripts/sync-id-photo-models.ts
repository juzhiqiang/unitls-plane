import { Logger } from '@nestjs/common';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';

const logger = new Logger('SyncIdPhotoModels');

/**
 * 把镜像内置的证件照本地抠图 @imgly/ISNet 资产树同步到 MinIO/S3 models 桶(只读匿名)。
 *
 * @imgly/background-removal 的资产是分块的:resources.json 清单 + 若干按 SHA256 命名的分块文件,
 * 运行时 loader 按 publicPath(`${NEXT_PUBLIC_S3_PUBLIC_URL}/models/imgly/<版本>/dist/`)逐块拉取
 * 并拼接。本脚本递归上传 `ID_PHOTO_MODELS_DIR` 下 `imgly/<版本>/dist/` 的全部文件,保持扁平结构
 * (分块文件名即清单里的 chunk.name),使 MinIO 公网 URL 与 loader 期望一致。
 *
 * 离线镜像启动时由 docker/start-all.sh 调用,保证无外网环境也能取到资产。
 * 失败不抛出(返回 0),避免 MinIO 未就绪时阻塞启动;下次重启会重试。
 *
 * 环境变量(与 MinioService 同约定):
 *   S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_REGION / S3_FORCE_PATH_STYLE
 *   S3_MODELS_BUCKET(默认 models)
 *   ID_PHOTO_MODELS_DIR(默认 /app/models/id-photo,镜像内资产目录)
 */
const IMGLY_PREFIX = 'imgly/';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

function contentTypeFor(name: string): string {
  if (name === 'resources.json') return 'application/json';
  if (name.endsWith('.wasm')) return 'application/wasm';
  if (name.endsWith('.mjs') || name.endsWith('.js')) return 'text/javascript';
  return 'application/octet-stream';
}

/** 递归遍历 dir,返回相对 base 的 POSIX 相对路径(用作 S3 key)。 */
async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full, base)));
    } else if (entry.isFile() && entry.name !== '.gitkeep') {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

async function main(): Promise<number> {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const region = process.env.S3_REGION ?? 'us-east-1';
  const bucket = process.env.S3_MODELS_BUCKET ?? 'models';
  const modelsDir = process.env.ID_PHOTO_MODELS_DIR ?? '/app/models/id-photo';

  if (!endpoint) {
    logger.warn('S3_ENDPOINT not set, skipping model sync');
    return 0;
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: accessKey || 'minioadmin',
      secretAccessKey: secretKey || 'minioadmin',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });

  try {
    // 1. 确保 models 桶存在
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      logger.log(`Bucket ${bucket} already exists`);
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      logger.log(`Created bucket ${bucket}`);
    }

    // 2. 匿名只读策略(允许前端公开拉取资产)
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`],
        },
      ],
    };
    try {
      await client.send(
        new PutBucketPolicyCommand({
          Bucket: bucket,
          Policy: JSON.stringify(policy),
        }),
      );
      logger.log(`Anonymous read policy set on ${bucket}`);
    } catch (err) {
      // 非 MinIO 后端可能不支持匿名策略,不阻塞
      logger.warn(`Bucket policy set skipped: ${(err as Error).message}`);
    }

    // 3. 递归列出资产树,只同步 imgly/ 前缀下的文件(版本无关,便于将来升级)
    let all: string[];
    try {
      all = await walk(modelsDir, modelsDir);
    } catch (err) {
      logger.warn(`Models dir ${modelsDir} not readable: ${(err as Error).message}`);
      return 0;
    }
    const files = all.filter(f => f.startsWith(IMGLY_PREFIX));
    if (files.length === 0) {
      logger.warn(`No files under ${IMGLY_PREFIX} in ${modelsDir}, skipping upload`);
      return 0;
    }

    // 4. 逐文件上传(S3 key 即相对路径,分块文件保持扁平 SHA256 命名)
    for (const rel of files) {
      const localPath = path.join(modelsDir, ...rel.split('/'));
      const body = await readFile(localPath);
      const name = rel.split('/').pop() ?? '';
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: rel,
          Body: body,
          ContentType: contentTypeFor(name),
          CacheControl: CACHE_CONTROL,
        }),
      );
      logger.log(`Synced ${rel} (${body.length} bytes) to ${bucket}`);
    }

    logger.log(`Model sync complete: ${files.length} files`);
    return 0;
  } catch (err) {
    logger.error(`Model sync failed: ${(err as Error).message}`);
    return 0; // 不阻塞启动
  }
}

main()
  .then(code => process.exit(code))
  .catch(() => process.exit(0));
