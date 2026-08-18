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
 * 把镜像内置的证件照本地抠图 onnx 模型同步到 MinIO/S3 models 桶(只读匿名)。
 *
 * 离线镜像启动时由 docker/start-all.sh 调用,保证无外网环境也能取到模型。
 * 失败不抛出(返回 0),避免 MinIO 未就绪时阻塞启动;下次重启会重试。
 *
 * 环境变量(与 MinioService 同约定):
 *   S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_REGION / S3_FORCE_PATH_STYLE
 *   S3_MODELS_BUCKET(默认 models)
 *   ID_PHOTO_MODELS_DIR(默认 /app/models/id-photo,镜像内模型目录)
 */
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

    // 2. 匿名只读策略(允许前端公开拉取模型)
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

    // 3. 上传模型文件
    let files: string[];
    try {
      files = await readdir(modelsDir);
    } catch (err) {
      logger.warn(`Models dir ${modelsDir} not readable: ${(err as Error).message}`);
      return 0;
    }
    const onnxFiles = files.filter(f => f.endsWith('.onnx'));
    if (onnxFiles.length === 0) {
      logger.warn(`No .onnx files in ${modelsDir}, skipping upload`);
      return 0;
    }

    for (const file of onnxFiles) {
      const filePath = path.join(modelsDir, file);
      const body = await readFile(filePath);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: file,
          Body: body,
          ContentType: 'application/octet-stream',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      logger.log(`Synced ${file} (${body.length} bytes) to ${bucket}`);
    }

    logger.log('Model sync complete');
    return 0;
  } catch (err) {
    logger.error(`Model sync failed: ${(err as Error).message}`);
    return 0; // 不阻塞启动
  }
}

main()
  .then(code => process.exit(code))
  .catch(() => process.exit(0));
