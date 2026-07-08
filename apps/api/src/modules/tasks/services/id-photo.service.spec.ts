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
