import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { markGeneratedImage } from './generated-image-marker';

async function solidPng(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
}

/**
 * 模拟上游 provider 在返回图里夹带元数据的情况。
 * 用 Artist —— 这是我们的标记不覆盖的字段,只有替换语义才能剥掉它。
 */
async function upstreamPngWithMetadata(payload: string): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: '#336699' },
  })
    .withExif({ IFD0: { Artist: payload } })
    .png()
    .toBuffer();
}

describe('markGeneratedImage', () => {
  it('embeds the generator and model as readable EXIF metadata', async () => {
    const tagged = await markGeneratedImage(await solidPng(), {
      model: 'gpt-image-1',
      generatedAt: new Date('2026-08-22T10:00:00.000Z'),
    });

    const metadata = await sharp(tagged).metadata();
    expect(metadata.format).toBe('png');
    const exif = metadata.exif?.toString('latin1') ?? '';
    expect(exif).toContain('Utils-Plane');
    expect(exif).toContain('gpt-image-1');
    expect(exif).toContain('2026-08-22');
    // 标记只写来源事实,不含 prompt。真正的守卫是 GeneratedImageMarkerOptions
    // 的类型签名(它没有 prompt 字段),这里只是把契约钉在测试里。
    expect(exif).not.toContain('prompt');
  });

  it('re-encodes any input format to png', async () => {
    const jpegInput = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer();
    expect((await sharp(jpegInput).metadata()).format).toBe('jpeg');

    const tagged = await markGeneratedImage(jpegInput, {
      model: 'gpt-image-1',
      generatedAt: new Date('2026-08-22T10:00:00.000Z'),
    });

    // 强制 png 是 ImageGenerationService 硬编码 mimeType/extension 的前提,
    // 即使 provider 返回 JPEG/WebP 也必须落成 png。
    const metadata = await sharp(tagged).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.exif?.toString('latin1') ?? '').toContain('Utils-Plane');
  });

  it('strips upstream metadata that could carry the prompt', async () => {
    const upstream = await upstreamPngWithMetadata('SECRET-PROMPT-CANARY');
    // 前提检查:载荷确实进了输入,否则这条断言是空转的。
    expect(upstream.toString('latin1')).toContain('SECRET-PROMPT-CANARY');

    const tagged = await markGeneratedImage(upstream, {
      model: 'gpt-image-1',
      generatedAt: new Date('2026-08-22T10:00:00.000Z'),
    });

    expect(tagged.toString('latin1')).not.toContain('SECRET-PROMPT-CANARY');
    const exif =
      (await sharp(tagged).metadata()).exif?.toString('latin1') ?? '';
    expect(exif).toContain('Utils-Plane');
    expect(exif).toContain('model=');
  });

  it('keeps the output decodable as a valid image', async () => {
    const tagged = await markGeneratedImage(await solidPng(), {
      model: 'm',
      generatedAt: new Date(),
    });

    const { width, height } = await sharp(tagged).metadata();
    expect(width).toBe(8);
    expect(height).toBe(8);
  });
});
