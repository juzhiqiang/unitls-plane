// 必须是第一个 import:加载仓库根目录 .env.local(详见 env-loader 注释)。
import '../env-loader';

import { Logger } from '@nestjs/common';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { readFile, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';

const logger = new Logger('SyncIdPhotoModels');

/**
 * 把镜像内置的证件照资产树同步到 MinIO/S3 models 桶(只读匿名)。
 *
 * 资产：
 *   rmbg/<version>/{config.json, preprocessor_config.json, onnx/model*.onnx}  RMBG-1.4（BRIA 许可，仅回落）
 *   modnet/modnet_photographic.onnx                                          MODNet photographic（Apache-2.0，主分割）
 *   face/yunet/face_detection_yunet_2023mar.onnx                             YuNet 人脸检测（MIT）
 *   ort/ort-wasm-simd-threaded{,.jsep}.{wasm,mjs}                            onnxruntime-web 运行时
 * 本脚本递归上传 `ID_PHOTO_MODELS_DIR` 下这些前缀的全部文件,保持相对路径作为 S3 key,
 * 使 MinIO 公网 URL 与前端 remoteHost / wasmPaths 期望一致。
 *
 * 离线镜像启动时由 docker/start-all.sh 调用,保证无外网环境也能取到资产
 * (transformers.js 默认会回落到 jsDelivr 取 ort wasm,离线环境必须自托管)。
 * 失败不抛出(返回 0),避免 MinIO 未就绪时阻塞启动;下次重启会重试。
 *
 * 环境变量(与 MinioService 同约定):
 *   S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_REGION / S3_FORCE_PATH_STYLE
 *   S3_MODELS_BUCKET(默认 models)
 *   ID_PHOTO_MODELS_DIR(默认探测 /app/models/id-photo 或 docker/models,镜像内/本地资产目录)
 */
const ASSET_PREFIXES = ['rmbg/', 'ort/', 'modnet/', 'face/'];
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

function contentTypeFor(name: string): string {
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.wasm')) return 'application/wasm';
  if (name.endsWith('.mjs') || name.endsWith('.js')) return 'text/javascript';
  if (name.endsWith('.onnx')) return 'application/octet-stream';
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

/**
 * 资产目录。显式配了就用配的；否则按候选顺序探测，
 * 让「仓库根跑」「apps/api 下跑」「容器内跑」三种情形都能命中。
 */
async function resolveModelsDir(): Promise<string | null> {
  const configured = process.env.ID_PHOTO_MODELS_DIR;
  const candidates = configured
    ? [configured]
    : [
        '/app/models/id-photo',
        path.resolve(process.cwd(), 'docker/models'),
        path.resolve(process.cwd(), '../../docker/models'),
        path.resolve(__dirname, '../../../../docker/models'),
        path.resolve(__dirname, '../../../docker/models'),
      ];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) return candidate;
    } catch {
      // 继续试下一个候选
    }
  }
  return null;
}

async function main(): Promise<number> {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const region = process.env.S3_REGION ?? 'us-east-1';
  const bucket = process.env.S3_MODELS_BUCKET ?? 'models';
  const modelsDir = await resolveModelsDir();

  if (!endpoint) {
    logger.warn('S3_ENDPOINT not set, skipping model sync');
    return 0;
  }

  if (!modelsDir) {
    logger.warn('Models directory not found, skipping model sync');
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
        })
      );
      logger.log(`Anonymous read policy set on ${bucket}`);
    } catch (err) {
      // 非 MinIO 后端可能不支持匿名策略,不阻塞
      logger.warn(`Bucket policy set skipped: ${(err as Error).message}`);
    }

    // 2b. CORS 配置(浏览器跨域拉取模型资产必须)
    // 前端从 NEXT_PUBLIC_S3_PUBLIC_URL 直接 fetch 模型文件,
    // 与 Web 页面不同源时 MinIO 需返回 Access-Control-Allow-Origin。
    const corsRules = {
      CORSRules: [
        {
          AllowedOrigins: ['*'],
          AllowedMethods: ['GET', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: [
            'Content-Length',
            'Content-Type',
            'ETag',
            'Cache-Control',
          ],
          MaxAgeSeconds: 86400,
        },
      ],
    };
    try {
      await client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: corsRules,
        })
      );
      logger.log(`CORS rules set on ${bucket}`);
    } catch (err) {
      logger.warn(`CORS config set skipped: ${(err as Error).message}`);
    }

    // 3. 递归列出资产树,只同步 ASSET_PREFIXES 下的文件(版本无关,便于将来升级)
    let all: string[];
    try {
      all = await walk(modelsDir, modelsDir);
    } catch (err) {
      logger.warn(
        `Models dir ${modelsDir} not readable: ${(err as Error).message}`
      );
      return 0;
    }
    const files = all.filter(f => ASSET_PREFIXES.some(p => f.startsWith(p)));
    if (files.length === 0) {
      logger.warn(
        `No files under ${ASSET_PREFIXES.join(' / ')} in ${modelsDir}, skipping upload`
      );
      return 0;
    }

    // 4. 逐文件上传(S3 key 即相对路径,与前端 remoteHost/wasmPaths 对齐)
    for (const rel of files) {
      const localPath = path.join(modelsDir, ...rel.split('/'));
      const fileStat = await stat(localPath);

      // 如果 S3 上已存在且大小一致，跳过上传以提升同步速度
      try {
        const head = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: rel,
          })
        );
        if (head.ContentLength === fileStat.size) {
          logger.log(`Skipped ${rel} (already up-to-date)`);
          continue;
        }
      } catch {
        // 对象不存在或获取元数据失败，执行上传
      }

      const body = await readFile(localPath);
      const name = rel.split('/').pop() ?? '';
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: rel,
          Body: body,
          ContentType: contentTypeFor(name),
          CacheControl: CACHE_CONTROL,
        })
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
