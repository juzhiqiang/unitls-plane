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
 *
 * 必须用 withExif(替换语义),不要改成 withMetadata(合并语义)。
 * withMetadata 会保留上游 provider 在返回图里夹带的元数据:PNG 的 tEXt chunk
 * (SD 与多数 OpenAI 兼容网关把 prompt 写在 keyword=parameters 里)和我们没覆盖的
 * EXIF 标签(如 Artist)都会原样进入产物。withExif 整块替换,把这些一并剥掉,
 * 是阻断上游元数据夹带 prompt 的关键。
 */
export async function markGeneratedImage(
  input: Buffer,
  { model, generatedAt }: GeneratedImageMarkerOptions
): Promise<Buffer> {
  return sharp(input)
    .withExif({
      IFD0: {
        Software: 'Utils-Plane AI Image Generation',
        ImageDescription: `AI-generated image; model=${model}; generatedAt=${generatedAt.toISOString()}`,
      },
    })
    .png()
    .toBuffer();
}
