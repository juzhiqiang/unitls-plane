export const AI_TRY_ON_REFERENCE_IMAGE_SOURCE = Symbol(
  'AI_TRY_ON_REFERENCE_IMAGE_SOURCE'
);

export type AiTryOnReferenceKind = 'person' | 'pose' | 'garment';

export interface AiTryOnReferencePromptMetadata {
  titleZh: string;
  titleEn: string;
  descriptionZh: string | null;
  descriptionEn: string | null;
  tags: string[];
}

export interface AiTryOnReferenceImageSource {
  getImageForGeneration(
    assetId: string,
    expectedKind: AiTryOnReferenceKind
  ): Promise<Buffer>;

  getPromptMetadata?(
    assetId: string,
    expectedKind: AiTryOnReferenceKind
  ): Promise<AiTryOnReferencePromptMetadata | null>;
}
