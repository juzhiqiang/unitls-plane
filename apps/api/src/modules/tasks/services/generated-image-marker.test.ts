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
  });

  it('never embeds the prompt', async () => {
    const tagged = await markGeneratedImage(await solidPng(), {
      model: 'gpt-image-1',
      generatedAt: new Date('2026-08-22T10:00:00.000Z'),
    });

    const exif =
      (await sharp(tagged).metadata()).exif?.toString('latin1') ?? '';
    expect(exif).not.toContain('prompt');
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
