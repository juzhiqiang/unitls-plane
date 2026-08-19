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

/** 造一张带 EXIF(含方向标签)的 JPEG。 */
async function makeExifImage(orientation = 1): Promise<Buffer> {
  return sharp({
    create: {
      width: 120,
      height: 80,
      channels: 3,
      background: { r: 10, g: 120, b: 200 },
    },
  })
    .jpeg()
    .withMetadata({
      orientation,
      exif: { IFD0: { Make: 'TestCam', Model: 'X100' } },
    })
    .toBuffer();
}

async function readExifText(buffer: Buffer): Promise<string> {
  const { exif } = await sharp(buffer).metadata();
  return exif ? exif.toString('latin1') : '';
}

describe('ImageService.compress metadata', () => {
  it('strips EXIF by default', async () => {
    const service = new ImageService();
    const output = await service.compress(await makeExifImage(), {
      format: 'jpeg',
      quality: 80,
    });

    expect(await readExifText(output)).not.toContain('TestCam');
  });

  it('keeps EXIF when preserveExif is set', async () => {
    const service = new ImageService();
    const output = await service.compress(await makeExifImage(), {
      format: 'jpeg',
      quality: 80,
      preserveExif: true,
    });

    expect(await readExifText(output)).toContain('TestCam');
  });

  it('does not rotate twice when preserving EXIF on an oriented image', async () => {
    const service = new ImageService();
    // orientation=6 表示需顺时针转 90 度才正。自动纠正会把 120x80 变成 80x120,
    // 若保留元数据时把 orientation=6 一起带回去,看图软件会再转一次。
    const output = await service.compress(await makeExifImage(6), {
      format: 'jpeg',
      quality: 80,
      preserveExif: true,
      transform: {
        autoOrient: true,
        rotate: 0,
        flipHorizontal: false,
        flipVertical: false,
      },
    });

    const metadata = await sharp(output).metadata();
    expect(metadata.width).toBe(80);
    expect(metadata.height).toBe(120);
    expect(metadata.orientation).toBe(1);
  });

  it('keeps EXIF through the target-size search as well', async () => {
    const service = new ImageService();
    const output = await service.compress(await makeExifImage(), {
      format: 'jpeg',
      quality: 92,
      maxSizeKB: 20,
      preserveExif: true,
    });

    expect(output.length).toBeLessThanOrEqual(20 * 1024);
    expect(await readExifText(output)).toContain('TestCam');
  });

  it('strips EXIF in target-size mode by default', async () => {
    const service = new ImageService();
    const output = await service.compress(await makeExifImage(), {
      format: 'jpeg',
      quality: 92,
      maxSizeKB: 20,
    });

    expect(await readExifText(output)).not.toContain('TestCam');
  });
});

/** 统计各象限的着墨像素,用来验证水印真的落在指定角落。 */
async function quadrantInk(
  buffer: Buffer
): Promise<{ tl: number; tr: number; bl: number; br: number }> {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const q = { tl: 0, tr: 0, bl: 0, br: 0 };
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      if ((data[i] ?? 255) >= 200) continue;
      const top = y < info.height / 2;
      const left = x < info.width / 2;
      if (top && left) q.tl += 1;
      else if (top) q.tr += 1;
      else if (left) q.bl += 1;
      else q.br += 1;
    }
  }
  return q;
}

async function whiteCanvas(): Promise<Buffer> {
  return sharp({
    create: {
      width: 600,
      height: 400,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
}

describe('ImageService.watermark positions', () => {
  const base = {
    text: 'WM',
    fontSize: 36,
    opacity: 1,
    color: { r: 0, g: 0, b: 0 },
    outputFormat: 'png' as const,
    margin: 24,
  };

  it('places the watermark in the requested corner', async () => {
    const service = new ImageService();
    const input = await whiteCanvas();

    const topLeft = await quadrantInk(
      await service.watermark(input, { ...base, position: 'top-left' })
    );
    expect(topLeft.tl).toBeGreaterThan(topLeft.br);
    expect(topLeft.tl).toBeGreaterThan(topLeft.tr);

    const bottomRight = await quadrantInk(
      await service.watermark(input, { ...base, position: 'bottom-right' })
    );
    expect(bottomRight.br).toBeGreaterThan(bottomRight.tl);

    const topRight = await quadrantInk(
      await service.watermark(input, { ...base, position: 'top-right' })
    );
    expect(topRight.tr).toBeGreaterThan(topRight.bl);

    const bottomLeft = await quadrantInk(
      await service.watermark(input, { ...base, position: 'bottom-left' })
    );
    expect(bottomLeft.bl).toBeGreaterThan(bottomLeft.tr);
  });

  it('supports every nine-grid position without throwing', async () => {
    const service = new ImageService();
    const input = await whiteCanvas();
    const positions = [
      'top-left',
      'top-center',
      'top-right',
      'middle-left',
      'center',
      'middle-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ] as const;

    for (const position of positions) {
      const output = await service.watermark(input, { ...base, position });
      const metadata = await sharp(output).metadata();
      expect(metadata.width).toBe(600);
      expect(metadata.height).toBe(400);
    }
  });

  it('outline adds ink without moving the watermark', async () => {
    const service = new ImageService();
    const input = await whiteCanvas();

    const plain = await service.watermark(input, {
      ...base,
      position: 'center',
    });
    const outlined = await service.watermark(input, {
      ...base,
      position: 'center',
      outline: true,
    });

    const [a, b] = await Promise.all([
      quadrantInk(plain),
      quadrantInk(outlined),
    ]);
    const total = (q: typeof a) => q.tl + q.tr + q.bl + q.br;
    // 描边只该让笔画变粗,不该把水印挪走。
    expect(total(b)).toBeGreaterThan(total(a));
  });
});
