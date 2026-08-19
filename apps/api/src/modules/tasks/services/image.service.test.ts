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

/**
 * 高熵噪声图:纯色图压完只有几百字节,任何目标体积都会「碰巧」达标,
 * 测不出搜索逻辑。用确定性伪随机填充保证 JPEG 压不动,又不引入随机性。
 */
async function makeNoisyImage(width = 800, height = 600): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 1;
  for (let i = 0; i < pixels.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = (seed >> 16) & 0xff;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe('ImageService.compress target size', () => {
  it('keeps the quality-only path unbounded when maxSizeKB is absent', async () => {
    const service = new ImageService();
    const input = await makeNoisyImage();

    const high = await service.compress(input, { format: 'jpeg', quality: 95 });
    const low = await service.compress(input, { format: 'jpeg', quality: 20 });

    // 质量模式不应有任何体积上限,高质量必须明显大于低质量。
    expect(high.length).toBeGreaterThan(low.length);
  });

  it('compresses jpeg down to the requested size', async () => {
    const service = new ImageService();
    const input = await makeNoisyImage();
    const targetKB = 60;

    const output = await service.compress(input, {
      format: 'jpeg',
      quality: 92,
      maxSizeKB: targetKB,
    });

    expect(output.length).toBeLessThanOrEqual(targetKB * 1024);
    expect((await sharp(output).metadata()).format).toBe('jpeg');
  });

  it('picks a higher quality than the probe floor when the target allows it', async () => {
    const service = new ImageService();
    const input = await makeNoisyImage();

    const generous = await service.compress(input, {
      format: 'jpeg',
      quality: 92,
      maxSizeKB: 300,
    });
    const tight = await service.compress(input, {
      format: 'jpeg',
      quality: 92,
      maxSizeKB: 60,
    });

    // 二分应当尽量贴近上限,而不是一律退到最低质量。
    expect(generous.length).toBeGreaterThan(tight.length);
    expect(generous.length).toBeLessThanOrEqual(300 * 1024);
  });

  it('downscales when quality alone cannot reach the target', async () => {
    const service = new ImageService();
    // 800×600 在最低质量下已经能压进 10KB,测不到降采样;必须给一张大到
    // 「质量到底仍超标」的图,才会走到 TARGET_SIZE_SCALE_STEPS。
    const input = await makeNoisyImage(2000, 1500);
    const targetKB = 10;

    const output = await service.compress(input, {
      format: 'jpeg',
      quality: 92,
      maxSizeKB: targetKB,
    });

    const metadata = await sharp(output).metadata();
    expect(output.length).toBeLessThanOrEqual(targetKB * 1024);
    expect(metadata.width).toBeLessThan(2000);
  });

  it('reaches the target for webp as well', async () => {
    const service = new ImageService();
    const input = await makeNoisyImage();
    const targetKB = 80;

    const output = await service.compress(input, {
      format: 'webp',
      quality: 92,
      maxSizeKB: targetKB,
    });

    expect(output.length).toBeLessThanOrEqual(targetKB * 1024);
    expect((await sharp(output).metadata()).format).toBe('webp');
  });

  it('reduces png size through palette and scale', async () => {
    const service = new ImageService();
    const input = await makeNoisyImage(400, 300);
    const targetKB = 40;

    const output = await service.compress(input, {
      format: 'png',
      maxSizeKB: targetKB,
    });

    expect(output.length).toBeLessThanOrEqual(targetKB * 1024);
    expect((await sharp(output).metadata()).format).toBe('png');
  });

  it('returns the smallest attempt instead of failing on an impossible target', async () => {
    const service = new ImageService();
    const input = await makeNoisyImage();

    const output = await service.compress(input, {
      format: 'jpeg',
      quality: 92,
      // 低于 clamp 下限,会被夹到 10KB;对这张噪声图仍然极难达成。
      maxSizeKB: 1,
    });

    expect(output.length).toBeGreaterThan(0);
    expect((await sharp(output).metadata()).format).toBe('jpeg');
  });

  it('respects maxWidth while searching for the target size', async () => {
    const service = new ImageService();
    const input = await makeNoisyImage();

    const output = await service.compress(input, {
      format: 'jpeg',
      quality: 92,
      maxWidth: 320,
      maxSizeKB: 500,
    });

    expect((await sharp(output).metadata()).width).toBeLessThanOrEqual(320);
  });
});
