import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import {
  GetObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { aiTryOnReferences, db } from '@utils-plane/db';

/** 图库素材类别。与 DB 枚举 ai_try_on_reference_kind 一致。 */
export type AiTryOnReferenceKind = 'person' | 'pose' | 'garment';

/** API 下发的语言。DB 存双语言列，按这个值取对应列拼成单语言扁平对象。 */
export type AiTryOnReferenceLang = 'zh' | 'en';

/**
 * 图库素材被拒绝时的失败关闭错误。
 *
 * 未启用、kind 不匹配、许可字段不齐全或记录不存在，都抛这个错：
 * 消息固定、不带 assetId / bucket / key，处理器拿它直接判任务失败即可。
 */
export class AiTryOnReferenceUnavailableError extends Error {
  constructor() {
    super('AI try-on reference asset is unavailable');
    this.name = 'AiTryOnReferenceUnavailableError';
  }
}

/** 下发给前端的图库素材。永不包含 bucket / storage key。 */
export interface AiTryOnReferenceDescriptor {
  id: string;
  kind: AiTryOnReferenceKind;
  title: string;
  description: string | null;
  tags: string[];
  /** 缩略图公网 URL；未配置 S3_PUBLIC_URL / NEXT_PUBLIC_S3_PUBLIC_URL 时为 null。 */
  thumbnailUrl: string | null;
  sourceUrl: string;
  licenseName: string;
  attribution: string;
  sortOrder: number;
}

/**
 * 试衣参考图库读取服务。
 *
 * 表见 packages/db/src/schema/ai-try-on-references.ts；素材存 MinIO 匿名只读桶
 * （桶名逐行记录，不硬编码），本服务负责两条路径：
 *
 * 1. `list()`：公开检索。只返回启用中且许可字段齐全的素材，按 lang 拼单语言对象；
 *    thumbnailUrl 由服务端拼好，bucket / key 不出网。
 * 2. `getImageForGeneration()`：任务处理器解析图库图时调用（服务端内部路径）。
 *    重新校验启用状态、许可字段和 kind，然后直接读对象存储返回 Buffer；
 *    任何一项不满足都失败关闭，不调用图像供应商。
 *
 * 注意 `role='style'` 的参考由处理器按 `expectedKind='garment'` 传入。
 */
@Injectable()
export class AiTryOnReferencesService {
  private readonly logger = new Logger(AiTryOnReferencesService.name);
  private client: S3Client | null = null;

  /**
   * 按类别返回启用中且许可齐全的图库素材，sortOrder 升序、id 兜底稳定排序。
   */
  async list(
    kind: AiTryOnReferenceKind,
    lang: AiTryOnReferenceLang
  ): Promise<AiTryOnReferenceDescriptor[]> {
    const rows = await db
      .select()
      .from(aiTryOnReferences)
      .where(
        and(
          eq(aiTryOnReferences.kind, kind),
          eq(aiTryOnReferences.isEnabled, true),
          // 许可/来源四项缺任何一项都视为未审查，fail closed。
          isNotNull(aiTryOnReferences.sourceUrl),
          isNotNull(aiTryOnReferences.licenseName),
          isNotNull(aiTryOnReferences.attribution),
          isNotNull(aiTryOnReferences.licenseReviewedAt)
        )
      )
      .orderBy(asc(aiTryOnReferences.sortOrder), asc(aiTryOnReferences.id));

    return rows.map(row => ({
      id: row.id,
      kind: row.kind,
      title: lang === 'en' ? row.titleEn : row.titleZh,
      description: lang === 'en' ? row.descriptionEn : row.descriptionZh,
      tags: row.tags ?? [],
      thumbnailUrl: buildPublicObjectUrl(
        row.thumbnailBucket,
        row.thumbnailStorageKey
      ),
      // where 已保证非空；断言仅为收敛类型。
      sourceUrl: row.sourceUrl ?? '',
      licenseName: row.licenseName ?? '',
      attribution: row.attribution ?? '',
      sortOrder: row.sortOrder,
    }));
  }

  /**
   * 任务处理器入口：解析一个图库 asset 的原图 Buffer。
   *
   * kind 必须匹配记录的 kind（处理器把 role='style' 映射为 'garment'），
   * 且记录必须启用中、许可字段齐全；否则抛 AiTryOnReferenceUnavailableError。
   * 对象存储读取失败原样抛出，由调用方按任务失败处理。
   */
  async getImageForGeneration(
    assetId: string,
    expectedKind: AiTryOnReferenceKind
  ): Promise<Buffer> {
    const rows = await db
      .select()
      .from(aiTryOnReferences)
      .where(
        and(
          eq(aiTryOnReferences.id, assetId),
          eq(aiTryOnReferences.kind, expectedKind),
          eq(aiTryOnReferences.isEnabled, true),
          isNotNull(aiTryOnReferences.sourceUrl),
          isNotNull(aiTryOnReferences.licenseName),
          isNotNull(aiTryOnReferences.attribution),
          isNotNull(aiTryOnReferences.licenseReviewedAt)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      this.logger.warn(
        `Rejected try-on reference lookup for asset ${assetId} (kind=${expectedKind})`
      );
      throw new AiTryOnReferenceUnavailableError();
    }

    return this.readObject(row.assetBucket, row.assetStorageKey);
  }

  /** 读对象存储。桶名来自记录本身，图库桶与上传桶分离。 */
  private async readObject(bucket: string, key: string): Promise<Buffer> {
    try {
      const response = await this.getClient().send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      const body = response.Body as unknown as AsyncIterable<Uint8Array>;
      if (!body) throw new Error('Object body is empty');
      const chunks: Uint8Array[] = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      // 只记 asset 维度信息：存储 key 不进日志。
      this.logger.warn(
        `Failed to read try-on reference object from bucket ${bucket}: ${
          error instanceof Error ? error.message : 'unknown'
        }`
      );
      throw error;
    }
  }

  /**
   * 惰性创建 S3 客户端（与 MinioService 同套环境变量）。
   * 测试可整体替换私有 client 字段，无需真实 MinIO。
   */
  private getClient(): S3Client {
    if (!this.client) {
      const config: S3ClientConfig = {
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? 'us-east-1',
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
          secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
        },
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      };
      this.client = new S3Client(config);
    }
    return this.client;
  }
}

/**
 * 拼匿名只读桶的公网 URL。优先 S3_PUBLIC_URL（服务端配置），
 * 回退 NEXT_PUBLIC_S3_PUBLIC_URL（与前端 presetImageUrl 同一取值）。
 * 都没配时返回 null：缩略图缺失不阻塞列表其余字段。
 */
function buildPublicObjectUrl(bucket: string, key: string): string | null {
  const base =
    process.env.S3_PUBLIC_URL ?? process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${bucket}/${key}`;
}
