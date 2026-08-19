import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { IdPhotoService } from './id-photo.service';

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

  it('hardens the final alpha mask to prevent background tint and white halos', async () => {
    const width = 295;
    const height = 413;
    const edge = width + 1;
    const center = Math.floor(height / 2) * width + Math.floor(width / 2);
    const imageRaw = Buffer.alloc(width * height * 3, 255);
    imageRaw[edge * 3] = 180;
    imageRaw[edge * 3 + 1] = 180;
    imageRaw[edge * 3 + 2] = 180;
    imageRaw[center * 3] = 0;
    imageRaw[center * 3 + 1] = 0;
    imageRaw[center * 3 + 2] = 0;

    const maskRaw = Buffer.alloc(width * height, 0);
    maskRaw[0] = 128;
    maskRaw[edge] = 128;
    maskRaw[center] = 128;

    const input = await sharp(imageRaw, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();

    const mask = await sharp(maskRaw, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => ({
        mask,
        faceCount: 1,
      }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/png',
      dpi: 300,
    });
    const outputRaw = await sharp(output.buffer).removeAlpha().raw().toBuffer();
    const haloPixel = outputRaw.subarray(0, 3);
    const grayFringePixel = outputRaw.subarray(edge * 3, edge * 3 + 3);
    const clothingPixel = outputRaw.subarray(center * 3, center * 3 + 3);

    expect([...haloPixel]).toEqual([255, 0, 0]);
    expect(grayFringePixel[1]).toBeLessThan(130);
    expect(grayFringePixel[2]).toBeLessThan(130);
    expect(clothingPixel[0]).toBeLessThan(40);
  });

  it('preserves light foreground details that are close to the original background color', async () => {
    const width = 295;
    const height = 413;
    const hat = Math.floor(height / 3) * width + Math.floor(width / 2);
    const solidHat = hat + 1;
    const imageRaw = Buffer.alloc(width * height * 3, 255);
    imageRaw[hat * 3] = 248;
    imageRaw[hat * 3 + 1] = 248;
    imageRaw[hat * 3 + 2] = 248;
    imageRaw[solidHat * 3] = 248;
    imageRaw[solidHat * 3 + 1] = 248;
    imageRaw[solidHat * 3 + 2] = 248;

    const maskRaw = Buffer.alloc(width * height, 0);
    maskRaw[hat] = 128;
    maskRaw[solidHat] = 255;

    const input = await sharp(imageRaw, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();
    const mask = await sharp(maskRaw, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();
    const service = new IdPhotoService({
      segment: async () => ({ mask, faceCount: 1 }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/png',
      dpi: 300,
    });
    const outputRaw = await sharp(output.buffer).removeAlpha().raw().toBuffer();
    const hatPixel = outputRaw.subarray(hat * 3, hat * 3 + 3);

    expect(hatPixel[1]).toBeGreaterThan(170);
    expect(hatPixel[2]).toBeGreaterThan(170);
  });

  it('replaces white background contamination on portrait edges with nearby foreground color', async () => {
    const width = 295;
    const height = 413;
    const edge = Math.floor(height / 2) * width + Math.floor(width / 2);
    const solid = edge + 1;
    const imageRaw = Buffer.alloc(width * height * 3, 255);
    imageRaw[solid * 3] = 0;
    imageRaw[solid * 3 + 1] = 0;
    imageRaw[solid * 3 + 2] = 0;

    const maskRaw = Buffer.alloc(width * height, 0);
    maskRaw[edge] = 128;
    maskRaw[solid] = 255;

    const input = await sharp(imageRaw, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();
    const mask = await sharp(maskRaw, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();
    const service = new IdPhotoService({
      segment: async () => ({ mask, faceCount: 1 }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/png',
      dpi: 300,
    });
    const outputRaw = await sharp(output.buffer).removeAlpha().raw().toBuffer();
    const edgePixel = outputRaw.subarray(edge * 3, edge * 3 + 3);

    expect(edgePixel[0]).toBeLessThan(90);
    expect(edgePixel[1]).toBeLessThan(90);
    expect(edgePixel[2]).toBeLessThan(90);
  });

  it('removes opaque white halo pixels on the portrait boundary', async () => {
    const width = 295;
    const height = 413;
    const halo = Math.floor(height / 2) * width + Math.floor(width / 2);
    const solid = halo + 1;
    const imageRaw = Buffer.alloc(width * height * 3, 255);
    imageRaw[solid * 3] = 0;
    imageRaw[solid * 3 + 1] = 0;
    imageRaw[solid * 3 + 2] = 0;

    const maskRaw = Buffer.alloc(width * height, 0);
    maskRaw[halo] = 255;
    maskRaw[solid] = 255;

    const input = await sharp(imageRaw, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();
    const mask = await sharp(maskRaw, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();
    const service = new IdPhotoService({
      segment: async () => ({ mask, faceCount: 1 }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/png',
      dpi: 300,
    });
    const outputRaw = await sharp(output.buffer).removeAlpha().raw().toBuffer();
    const haloPixel = outputRaw.subarray(halo * 3, halo * 3 + 3);

    expect(haloPixel[0]).toBeLessThan(90);
    expect(haloPixel[1]).toBeLessThan(90);
    expect(haloPixel[2]).toBeLessThan(90);
  });

  it('removes multi-pixel opaque white halos near the portrait boundary', async () => {
    const width = 295;
    const height = 413;
    const outerHalo = Math.floor(height / 2) * width + Math.floor(width / 2);
    const middleHalo = outerHalo + 1;
    const innerHalo = outerHalo + 2;
    const solid = outerHalo + 3;
    const imageRaw = Buffer.alloc(width * height * 3, 255);
    imageRaw[solid * 3] = 0;
    imageRaw[solid * 3 + 1] = 0;
    imageRaw[solid * 3 + 2] = 0;

    const maskRaw = Buffer.alloc(width * height, 0);
    maskRaw[outerHalo] = 255;
    maskRaw[middleHalo] = 255;
    maskRaw[innerHalo] = 255;
    maskRaw[solid] = 255;

    const input = await sharp(imageRaw, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();
    const mask = await sharp(maskRaw, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();
    const service = new IdPhotoService({
      segment: async () => ({ mask, faceCount: 1 }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/png',
      dpi: 300,
    });
    const outputRaw = await sharp(output.buffer).removeAlpha().raw().toBuffer();
    const innerHaloPixel = outputRaw.subarray(innerHalo * 3, innerHalo * 3 + 3);

    expect(innerHaloPixel[0]).toBeLessThan(90);
    expect(innerHaloPixel[1]).toBeLessThan(90);
    expect(innerHaloPixel[2]).toBeLessThan(90);
  });

  it('removes thick opaque white halo bands around the portrait', async () => {
    const width = 295;
    const height = 413;
    const bandX = Math.floor(width / 2);
    const bandTop = Math.floor(height / 2) - 4;
    const bandBottom = bandTop + 9;
    const sampleY = bandTop + 4;
    const sample = sampleY * width + bandX + 5;
    const imageRaw = Buffer.alloc(width * height * 3, 255);

    const maskRaw = Buffer.alloc(width * height, 0);
    for (let y = bandTop; y < bandBottom; y += 1) {
      for (let offset = 0; offset <= 6; offset += 1) {
        maskRaw[y * width + bandX + offset] = 255;
      }
      const solid = y * width + bandX + 7;
      maskRaw[solid] = 255;
      imageRaw[solid * 3] = 0;
      imageRaw[solid * 3 + 1] = 0;
      imageRaw[solid * 3 + 2] = 0;
    }

    const input = await sharp(imageRaw, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();
    const mask = await sharp(maskRaw, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();
    const service = new IdPhotoService({
      segment: async () => ({ mask, faceCount: 1 }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/png',
      dpi: 300,
    });
    const outputRaw = await sharp(output.buffer).removeAlpha().raw().toBuffer();
    const innerHaloPixel = outputRaw.subarray(sample * 3, sample * 3 + 3);

    expect(innerHaloPixel[0]).toBeLessThan(90);
    expect(innerHaloPixel[1]).toBeLessThan(90);
    expect(innerHaloPixel[2]).toBeLessThan(90);
  });

  it('falls back to the target background when a white boundary halo has no reliable foreground color', async () => {
    const width = 295;
    const height = 413;
    const halo = Math.floor(height / 2) * width + Math.floor(width / 2);
    const imageRaw = Buffer.alloc(width * height * 3, 255);
    const maskRaw = Buffer.alloc(width * height, 0);
    maskRaw[halo] = 255;

    const input = await sharp(imageRaw, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();
    const mask = await sharp(maskRaw, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();
    const service = new IdPhotoService({
      segment: async () => ({ mask, faceCount: 1 }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/png',
      dpi: 300,
    });
    const outputRaw = await sharp(output.buffer).removeAlpha().raw().toBuffer();
    const haloPixel = outputRaw.subarray(halo * 3, halo * 3 + 3);

    expect([...haloPixel]).toEqual([255, 0, 0]);
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
