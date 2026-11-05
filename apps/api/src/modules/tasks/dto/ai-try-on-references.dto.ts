import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { AiTryOnReferenceKind } from '../services/ai-try-on-references.service';

/** 图库素材类别（与 DB 枚举一致）。 */
export const AI_TRY_ON_REFERENCE_KINDS: AiTryOnReferenceKind[] = [
  'person',
  'pose',
  'garment',
];

/** 下发的语言。 */
export const AI_TRY_ON_REFERENCE_LANGS = ['zh', 'en'] as const;

export class ListAiTryOnReferencesQueryDto {
  @ApiProperty({
    description: '素材类别：person 人像 / pose 姿势 / garment 服饰',
    enum: AI_TRY_ON_REFERENCE_KINDS,
  })
  @IsIn(AI_TRY_ON_REFERENCE_KINDS)
  kind!: AiTryOnReferenceKind;

  @ApiPropertyOptional({
    description: '标题/描述语言，默认 zh',
    enum: AI_TRY_ON_REFERENCE_LANGS,
    default: 'zh',
  })
  @IsOptional()
  @IsIn(AI_TRY_ON_REFERENCE_LANGS)
  lang?: 'zh' | 'en';
}

export class AiTryOnReferenceDto {
  @ApiProperty({ description: '素材 id（uuid）', format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: '素材类别',
    enum: AI_TRY_ON_REFERENCE_KINDS,
  })
  kind!: AiTryOnReferenceKind;

  @ApiProperty({ description: '当前语言（由 lang 查询参数决定）的标题' })
  title!: string;

  @ApiProperty({
    description: '当前语言的描述；未提供时为 null',
    nullable: true,
    type: String,
  })
  description!: string | null;

  @ApiProperty({
    description: '检索用标签',
    type: [String],
  })
  tags!: string[];

  @ApiProperty({
    description:
      '缩略图公网 URL（服务端拼接，不下发 bucket / storage key）；未配置公网 base 时为 null',
    nullable: true,
    type: String,
  })
  thumbnailUrl!: string | null;

  @ApiProperty({ description: '素材来源 URL' })
  sourceUrl!: string;

  @ApiProperty({ description: '许可名称' })
  licenseName!: string;

  @ApiProperty({ description: '署名要求' })
  attribution!: string;

  @ApiProperty({ description: '排序值，升序展示' })
  sortOrder!: number;
}
