import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { IdPhotoService } from '../../../../src/modules/tasks/services/id-photo.service';

describe('IdPhotoService', () => {
  it('renders a JPEG with the selected preset size and background color', async () => {
    const input = await sharp({
      create: {
        width: 500,
        height: 700,
        channels: 3,
        background: '#dddddd',
      },
    })
      .jpeg()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => ({
        mask: await sharp(Buffer.alloc(500 * 700, 255), {
          raw: {
            width: 500,
            height: 700,
            channels: 1,
          },
        })
          .png()
          .toBuffer(),
        bounds: { x: 100, y: 80, width: 300, height: 520 },
        faceCount: 1,
      }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/jpeg',
      dpi: 300,
    });

    const metadata = await sharp(output.buffer).metadata();
    expect(metadata.width).toBe(295);
    expect(metadata.height).toBe(413);
    expect(output.mimeType).toBe('image/jpeg');
    expect(output.extension).toBe('jpg');
  });

  it('throws NO_FACE_DETECTED when the segmentation service reports zero faces', async () => {
    const input = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .png()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => ({
        mask: Buffer.alloc(0),
        faceCount: 0,
      }),
    } as any);

    await expect(
      service.render(input, {
        preset: 'passport',
        backgroundColor: '#ffffff',
        outputType: 'image/png',
        dpi: 300,
      })
    ).rejects.toMatchObject({ code: 'NO_FACE_DETECTED' });
  });

  it('passes the requested segmentation mode to the segmentation service', async () => {
    const input = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .png()
      .toBuffer();
    let receivedMode: unknown;
    const service = new IdPhotoService({
      segment: async (_input: Buffer, options?: { mode?: string }) => {
        receivedMode = options?.mode;
        return {
          mask: await sharp(Buffer.alloc(300 * 300, 255), {
            raw: { width: 300, height: 300, channels: 1 },
          })
            .png()
            .toBuffer(),
          faceCount: 1,
        };
      },
    } as any);

    await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
      segmentationMode: 'ai',
    });

    expect(receivedMode).toBe('ai');
  });

  it('uses an AI-rendered result image directly when image result mode is configured', async () => {
    const input = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .png()
      .toBuffer();
    const aiResult = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 3,
        background: '#438edb',
      },
    })
      .png()
      .toBuffer();
    let renderOptions: unknown;
    const service = new IdPhotoService({
      renderIdPhoto: async (_input: Buffer, options: unknown) => {
        renderOptions = options;
        return aiResult;
      },
      segment: async () => {
        throw new Error('local segmentation should not run');
      },
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
      segmentationMode: 'ai',
    });

    const metadata = await sharp(output.buffer).metadata();
    expect(metadata.width).toBe(295);
    expect(metadata.height).toBe(413);
    expect(output.mimeType).toBe('image/jpeg');
    expect(output.extension).toBe('jpg');
    expect(renderOptions).toMatchObject({
      width: 295,
      height: 413,
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
    });
  });

  it('does not fall back to local segmentation when AI-rendered result fails', async () => {
    const input = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .png()
      .toBuffer();
    let localSegmentationRan = false;
    const service = new IdPhotoService({
      renderIdPhoto: async () => {
        throw new Error('upstream image edit failed');
      },
      segment: async () => {
        localSegmentationRan = true;
        return {
          mask: await sharp(Buffer.alloc(300 * 300, 255), {
            raw: { width: 300, height: 300, channels: 1 },
          })
            .png()
            .toBuffer(),
          faceCount: 1,
        };
      },
    } as any);

    await expect(
      service.render(input, {
        preset: 'one_inch',
        backgroundColor: '#438edb',
        outputType: 'image/jpeg',
        dpi: 300,
        segmentationMode: 'ai',
      })
    ).rejects.toThrow('upstream image edit failed');
    expect(localSegmentationRan).toBe(false);
  });
});

/**
 * 造一张左右两半颜色不同的源图 + 全白 mask,这样裁剪框往哪边偏移可以直接从
 * 输出像素的颜色看出来 —— 纯色图测不出 crop 是否真的生效。
 */
async function makeSplitInput(width = 600, height = 800): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const left = x < width / 2;
      pixels[i] = left ? 255 : 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = left ? 0 : 255;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg()
    .toBuffer();
}

function fullMaskService(width: number, height: number) {
  return new IdPhotoService({
    segment: async () => ({
      mask: await sharp(Buffer.alloc(width * height, 255), {
        raw: { width, height, channels: 1 },
      })
        .png()
        .toBuffer(),
      bounds: { x: 0, y: 0, width, height },
      faceCount: 1,
    }),
  } as any);
}

async function averageRed(buffer: Buffer): Promise<number> {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += info.channels) sum += data[i] ?? 0;
  return sum / (data.length / info.channels);
}

describe('IdPhotoService reference parity', () => {
  async function makeInput() {
    // 纯色源图测不出裁剪位置：自动构图与居中裁剪会产出完全相同的像素。
    // 用二维渐变让裁剪框的缩放/偏移体现在输出字节上。
    const width = 600;
    const height = 800;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 3;
        pixels[i] = Math.round((x / (width - 1)) * 255);
        pixels[i + 1] = Math.round((y / (height - 1)) * 255);
        pixels[i + 2] = 128;
      }
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  function fullSegmentation() {
    return {
      segment: async () => ({
        mask: await sharp(Buffer.alloc(600 * 800, 255), {
          raw: { width: 600, height: 800, channels: 1 },
        })
          .png()
          .toBuffer(),
        bounds: { x: 0, y: 0, width: 600, height: 800 },
        faceCount: 1,
      }),
    } as any;
  }

  const detectedFace = {
    box: { x: 200, y: 150, width: 180, height: 180 },
    landmarks: [
      [230, 230],
      [350, 230],
      [290, 260],
      [265, 290],
      [315, 290],
    ] as Array<[number, number]>,
    score: 0.95,
  };

  it('writes 300 dpi into the JPEG output', async () => {
    const input = await makeInput();
    const service = new IdPhotoService(fullSegmentation());

    const result = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
    });

    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(295);
    expect(meta.height).toBe(413);
    expect(meta.density).toBe(300);
  });

  it('writes 300 dpi into the PNG output', async () => {
    const input = await makeInput();
    const service = new IdPhotoService(fullSegmentation());

    const result = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/png',
      dpi: 300,
    });

    const meta = await sharp(result.buffer).metadata();
    expect(meta.density).toBe(300);
  });

  it('uses the detected face to auto-frame when no crop is supplied', async () => {
    const input = await makeInput();
    const withFace = new IdPhotoService(fullSegmentation(), {
      detect: async () => [detectedFace],
    } as never);
    const withoutFace = new IdPhotoService(fullSegmentation());

    const config = {
      preset: 'one_inch' as const,
      backgroundColor: '#438edb',
      outputType: 'image/jpeg' as const,
      dpi: 300 as const,
    };

    const a = await withFace.render(input, config);
    const b = await withoutFace.render(input, config);
    // 自动构图会缩放/偏移，两次产出的字节不应相同
    expect(Buffer.compare(a.buffer, b.buffer)).not.toBe(0);
  });

  it('honours an explicit crop over the detected face', async () => {
    const input = await makeInput();
    const detect = async () => [detectedFace];
    const segmentation = fullSegmentation();

    const withExplicitCrop = new IdPhotoService(segmentation, {
      detect,
    } as never);
    const withoutCrop = new IdPhotoService(segmentation, { detect } as never);

    const base = {
      preset: 'one_inch' as const,
      backgroundColor: '#438edb',
      outputType: 'image/jpeg' as const,
      dpi: 300 as const,
    };

    const a = await withExplicitCrop.render(input, {
      ...base,
      crop: { x: 0.5, y: 0.5, scale: 1 },
    });
    const b = await withoutCrop.render(input, base);
    expect(Buffer.compare(a.buffer, b.buffer)).not.toBe(0);
  });

  it('returns a quality report with eight items', async () => {
    const input = await makeInput();
    const service = new IdPhotoService(fullSegmentation());
    const result = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
    });
    expect(result.quality!.items.length).toBe(8);
  });
});

describe('IdPhotoService crop', () => {
  const base = {
    preset: 'one_inch' as const,
    backgroundColor: '#ffffff',
    outputType: 'image/jpeg' as const,
    dpi: 300 as const,
  };

  it('shifts the framing toward the requested centre', async () => {
    const input = await makeSplitInput();
    const service = fullMaskService(600, 800);

    // 源图左半红右半蓝;把裁剪中心推到左侧应显著提高输出的平均红色分量。
    const left = await service.render(input, {
      ...base,
      crop: { x: 0.2, y: 0.5, scale: 2 },
    });
    const right = await service.render(input, {
      ...base,
      crop: { x: 0.8, y: 0.5, scale: 2 },
    });

    expect(await averageRed(left.buffer)).toBeGreaterThan(
      await averageRed(right.buffer)
    );
  });

  it('keeps the preset output size regardless of crop', async () => {
    const input = await makeSplitInput();
    const service = fullMaskService(600, 800);

    for (const crop of [
      { x: 0.5, y: 0.5, scale: 1 },
      { x: 0, y: 0, scale: 3 },
      { x: 1, y: 1, scale: 2.5 },
    ]) {
      const output = await service.render(input, { ...base, crop });
      const metadata = await sharp(output.buffer).metadata();
      expect(metadata.width).toBe(295);
      expect(metadata.height).toBe(413);
    }
  });

  it('matches the previous centred behaviour when crop is omitted', async () => {
    const input = await makeSplitInput();
    const service = fullMaskService(600, 800);

    const withoutCrop = await service.render(input, base);
    const withDefaultCrop = await service.render(input, {
      ...base,
      crop: { x: 0.5, y: 0.5, scale: 1 },
    });

    expect(await averageRed(withoutCrop.buffer)).toBeCloseTo(
      await averageRed(withDefaultCrop.buffer),
      0
    );
  });
});
