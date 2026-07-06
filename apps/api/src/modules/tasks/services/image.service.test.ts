import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { ImageService } from './image.service';

async function makeInputImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 240,
      height: 160,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
}

describe('ImageService.watermark', () => {
  it('adds a visible text watermark while preserving image dimensions', async () => {
    const service = new ImageService();
    const input = await makeInputImage();

    const output = await service.watermark(input, {
      text: 'BRAND',
      position: 'center',
      fontSize: 36,
      opacity: 0.6,
      color: { r: 160, g: 32, b: 32 },
      outputFormat: 'png',
    });

    const metadata = await sharp(output).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(240);
    expect(metadata.height).toBe(160);

    const [before, after] = await Promise.all([
      sharp(input).raw().toBuffer(),
      sharp(output).raw().toBuffer(),
    ]);
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  it('can export a watermarked image as jpeg', async () => {
    const service = new ImageService();
    const input = await makeInputImage();

    const output = await service.watermark(input, {
      text: 'COPYRIGHT',
      position: 'tile',
      fontSize: 24,
      opacity: 0.25,
      rotation: -30,
      outputFormat: 'jpeg',
      quality: 82,
    });

    const metadata = await sharp(output).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(240);
    expect(metadata.height).toBe(160);
  });
});

async function makeTwoPixelImage(): Promise<Buffer> {
  return sharp(Buffer.from([255, 0, 0, 0, 0, 255]), {
    raw: {
      width: 2,
      height: 1,
      channels: 3,
    },
  })
    .png()
    .toBuffer();
}

describe('ImageService image transforms', () => {
  it('rotates images from existing compress tasks through inputConfig.transform', async () => {
    const service = new ImageService();
    const input = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();

    const output = await service.compress(input, {
      format: 'png',
      transform: {
        autoOrient: true,
        rotate: 90,
        flipHorizontal: false,
        flipVertical: false,
      },
    });

    const metadata = await sharp(output).metadata();
    expect(metadata.width).toBe(80);
    expect(metadata.height).toBe(120);
  });

  it('flips images horizontally from existing convert tasks through inputConfig.transform', async () => {
    const service = new ImageService();
    const input = await makeTwoPixelImage();

    const output = await service.convert(input, {
      toFormat: 'png',
      transform: {
        autoOrient: true,
        rotate: 0,
        flipHorizontal: true,
        flipVertical: false,
      },
    });

    const pixels = await sharp(output).raw().toBuffer();
    expect([...pixels.slice(0, 3)]).toEqual([0, 0, 255]);
    expect([...pixels.slice(3, 6)]).toEqual([255, 0, 0]);
  });
});
