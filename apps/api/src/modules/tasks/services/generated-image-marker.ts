import sharp from 'sharp';

export interface GeneratedImageMarkerOptions {
  model: string;
  generatedAt: Date;
}

/**
 * 给 AI 生成图写入隐式来源标识(生成方、模型、生成时间)。
 *
 * 只写不可争议的来源事实,绝不写 prompt —— 产物文件可能被用户分享出去。
 * 不加可见水印。
 */
export async function markGeneratedImage(
  input: Buffer,
  { model, generatedAt }: GeneratedImageMarkerOptions
): Promise<Buffer> {
  return sharp(input)
    .withMetadata({
      exif: {
        IFD0: {
          Software: 'Utils-Plane AI Image Generation',
          ImageDescription: `AI-generated image; model=${model}; generatedAt=${generatedAt.toISOString()}`,
        },
      },
    })
    .png()
    .toBuffer();
}
