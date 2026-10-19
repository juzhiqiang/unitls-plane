import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import {
  estimateSourceBackgroundColors,
  idPhotoCropFromLayout,
  mapFaceToOutput,
  resolveIdPhotoCropBox,
  suggestBrightnessAdjustment,
  suggestIdPhotoLayout,
} from '@utils-plane/validators';
import { decontaminateIdPhotoForeground } from '@utils-plane/utils';
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

  it('falls back to the segmentation face count when detection is unavailable', async () => {
    const input = await makeInput();
    const service = new IdPhotoService(fullSegmentation());
    const result = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
    });
    const faceCount = result.quality!.items.find(i => i.name === 'faceCount')!;
    expect(faceCount.value).toBe('1');
    expect(faceCount.passed).toBe(true);
  });

  it('reports face metrics in output coordinates for an auto-framed face', async () => {
    const input = await makeInput();
    const service = new IdPhotoService(fullSegmentation(), {
      detect: async () => [detectedFace],
    } as never);
    const result = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
    });

    const items = Object.fromEntries(
      result.quality!.items.map(item => [item.name, item])
    );
    // 源图坐标下 180/600 = 30%，映射到成片后应约为 35%；
    // 若直接传源图坐标则会是 180/295 = 61% 并判失败。
    expect(items.faceRatio!.value).toBe('35%');
    expect(items.faceRatio!.passed).toBe(true);
    expect(items.faceCentered!.passed).toBe(true);
    expect(items.headroom!.passed).toBe(true);
    expect(items.eyeTilt!.passed).toBe(true);
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

describe('mapFaceToOutput', () => {
  const preset = { widthPx: 295, heightPx: 413 };
  const baseBox = { left: 100, top: 50, width: 400, height: 560 };

  it('maps a face centred in the crop box to the output centre', () => {
    const face = {
      box: { x: 280, y: 310, width: 40, height: 40 },
      landmarks: [
        [290, 320],
        [310, 320],
      ] as Array<[number, number]>,
      score: 0.9,
    };

    const mapped = mapFaceToOutput(face, baseBox, preset, 0);

    expect(mapped.box.x + mapped.box.width / 2).toBeCloseTo(147.5, 6);
    expect(mapped.box.y + mapped.box.height / 2).toBeCloseTo(206.5, 6);
  });

  it('maps a face in the crop box top-left corner to the output top-left', () => {
    const face = {
      box: { x: 100, y: 50, width: 40, height: 40 },
      landmarks: [] as Array<[number, number]>,
      score: 0.9,
    };

    const mapped = mapFaceToOutput(face, baseBox, preset, 0);

    // 缩放比 = 295 / 400 = 413 / 560 = 0.7375
    expect(mapped.box.x).toBeCloseTo(0, 6);
    expect(mapped.box.y).toBeCloseTo(0, 6);
    expect(mapped.box.width).toBeCloseTo(29.5, 6);
    expect(mapped.box.height).toBeCloseTo(29.5, 6);
  });

  it('rotates the mapped face in the same direction as sharp rotate(-rotation)', () => {
    // 脸位于裁剪框中心正上方。layout.rotation 为正表示右眼更低；
    // 渲染用 sharp 的 rotate(-rotation)（负值 = 逆时针），因此上方的人脸
    // 应当向左移动。
    const face = {
      box: { x: 280, y: 110, width: 40, height: 40 },
      landmarks: [] as Array<[number, number]>,
      score: 0.9,
    };

    const corrected = mapFaceToOutput(face, baseBox, preset, 5);
    const doubled = mapFaceToOutput(face, baseBox, preset, -5);
    const correctedCenterX = corrected.box.x + corrected.box.width / 2;
    const doubledCenterX = doubled.box.x + doubled.box.width / 2;

    expect(correctedCenterX).toBeLessThan(147.5 - 10);
    expect(corrected.box.y).toBeCloseTo(doubled.box.y, 6);
    // 反方向（与渲染方向一致）落在右侧，说明两者可以用符号区分。
    expect(doubledCenterX).toBeGreaterThan(147.5 + 10);
  });
});

describe('IdPhotoService layout direction', () => {
  function fullMask(width: number, height: number) {
    return sharp(Buffer.alloc(width * height, 255), {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();
  }

  async function makeMarkerInput(): Promise<Buffer> {
    const width = 600;
    const height = 800;
    const pixels = Buffer.alloc(width * height * 3);
    // 黑色背景 + 位于裁剪框中心正上方 210px 的白色方块。
    for (let y = 136; y < 166; y += 1) {
      for (let x = 274; x < 304; x += 1) {
        const i = (y * width + x) * 3;
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
      }
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
  }

  async function brightCentroid(buffer: Buffer) {
    const { data, info } = await sharp(buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * info.channels;
        const luminance =
          (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
        if (luminance > 384) {
          sumX += x;
          sumY += y;
          count += 1;
        }
      }
    }
    return {
      x: count ? sumX / count : Number.NaN,
      y: count ? sumY / count : Number.NaN,
      count,
    };
  }

  it('renders the layout rotation as a correction, not a doubled tilt', async () => {
    const width = 600;
    const height = 800;
    // 右眼比左眼低 10px → tilt ≈ 4.76°，layout.rotation 被夹到 +5°。
    const tiltedFace = {
      box: { x: 200, y: 150, width: 180, height: 180 },
      landmarks: [
        [230, 230],
        [350, 240],
        [290, 260],
        [265, 290],
        [315, 290],
      ] as Array<[number, number]>,
      score: 0.95,
    };
    const targetAspect = 295 / 413;
    const layout = suggestIdPhotoLayout(
      tiltedFace,
      { width, height },
      targetAspect,
      0
    )!;
    expect(layout.rotation).toBe(5);

    const crop = idPhotoCropFromLayout(layout, { width, height }, targetAspect);
    const baseBox = resolveIdPhotoCropBox(width, height, 295, 413, crop);

    const markerFace = {
      box: { x: 274, y: 136, width: 30, height: 30 },
      landmarks: [] as Array<[number, number]>,
      score: 1,
    };
    const corrected = mapFaceToOutput(
      markerFace,
      baseBox,
      { widthPx: 295, heightPx: 413 },
      layout.rotation
    );
    const doubled = mapFaceToOutput(
      markerFace,
      baseBox,
      { widthPx: 295, heightPx: 413 },
      -layout.rotation
    );

    const service = new IdPhotoService(
      {
        segment: async () => ({
          mask: await fullMask(width, height),
          bounds: { x: 0, y: 0, width, height },
          faceCount: 1,
        }),
      } as any,
      { detect: async () => [tiltedFace] } as never
    );

    const result = await service.render(await makeMarkerInput(), {
      preset: 'one_inch',
      backgroundColor: '#000000',
      outputType: 'image/jpeg',
      dpi: 300,
      segmentationMode: 'local',
    });
    const centroid = await brightCentroid(result.buffer);

    const correctedX = corrected.box.x + corrected.box.width / 2;
    const doubledX = doubled.box.x + doubled.box.width / 2;

    expect(centroid.count).toBeGreaterThan(0);
    // 成片中心在 x=147.5；正确的逆时针回正应把上方标记带到左侧，
    // 若服务端误用 rotate(+rotation) 则会跑到右侧。
    expect(centroid.x).toBeLessThan(147.5 - 5);
    expect(Math.abs(centroid.x - correctedX)).toBeLessThan(
      Math.abs(centroid.x - doubledX)
    );
  });
});

describe('IdPhotoService crown detection', () => {
  it('ignores sparse noise rows above the real crown', async () => {
    const width = 600;
    const height = 100;
    const mask = Buffer.alloc(width * height, 0);
    // 顶部噪点：只有 2 个像素
    mask[3 * width + 10] = 255;
    mask[3 * width + 11] = 255;
    // 真实头顶：20 个像素（>= max(3, 600 * 0.02) = 12）
    for (let x = 100; x < 120; x += 1) mask[40 * width + x] = 255;
    const maskPng = await sharp(mask, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => {
        throw new Error('not used');
      },
    } as any);

    expect(await (service as any).detectCrownY(maskPng)).toBe(40);
  });

  it('returns undefined for an empty mask', async () => {
    const maskPng = await sharp(Buffer.alloc(600 * 100, 0), {
      raw: { width: 600, height: 100, channels: 1 },
    })
      .png()
      .toBuffer();
    const service = new IdPhotoService({
      segment: async () => {
        throw new Error('not used');
      },
    } as any);

    expect(await (service as any).detectCrownY(maskPng)).toBeUndefined();
  });
});

describe('IdPhotoService RGBA assembly', () => {
  async function samplePixel(buffer: Buffer, x: number, y: number) {
    const { data, info } = await sharp(buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return {
      r: data[i] ?? 0,
      g: data[i + 1] ?? 0,
      b: data[i + 2] ?? 0,
    };
  }

  it('combines base RGB with mask alpha before compositing the background', async () => {
    const width = 600;
    const height = 800;
    const basePixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i += 1) {
      basePixels[i * 3] = 255; // 纯红
    }
    const input = await sharp(basePixels, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();

    const alphaPixels = Buffer.alloc(width * height, 255);
    // 右半透明，左半不透明
    for (let y = 0; y < height; y += 1) {
      for (let x = 300; x < width; x += 1) {
        alphaPixels[y * width + x] = 0;
      }
    }
    const mask = await sharp(alphaPixels, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => ({
        mask,
        bounds: { x: 0, y: 0, width, height },
        faceCount: 1,
      }),
    } as any);

    const result = await service.render(input, {
      preset: 'one_inch',
      // 右半应完全显示这个底色
      backgroundColor: '#0000ff',
      outputType: 'image/png',
      dpi: 300,
      segmentationMode: 'local',
    });

    const left = await samplePixel(result.buffer, 30, 206);
    const right = await samplePixel(result.buffer, 264, 206);

    expect(left.r).toBeGreaterThan(200);
    expect(left.b).toBeLessThan(40);
    expect(right.b).toBeGreaterThan(200);
    expect(right.r).toBeLessThan(40);
  });
});

describe('IdPhotoService brightness correction', () => {
  async function meanOutput(buffer: Buffer): Promise<number> {
    const { data, info } = await sharp(buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      sum += ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
    }
    return sum / (data.length / info.channels);
  }

  async function renderFlatGray(value: number): Promise<number> {
    const width = 300;
    const height = 400;
    const pixels = Buffer.alloc(width * height * 3, value);
    const input = await sharp(pixels, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();

    const service = new IdPhotoService({
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

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ffffff',
      outputType: 'image/png',
      dpi: 300,
      segmentationMode: 'local',
    });
    return meanOutput(output.buffer);
  }

  it('brightens an underexposed photo toward mid-grey', async () => {
    const mean = await renderFlatGray(40);
    // 40 → 建议 +18;透明区外的整幅前景都应抬亮。
    expect(mean).toBeCloseTo(58, 0);
    expect(Math.abs(mean - 128)).toBeLessThan(Math.abs(40 - 128));
  });

  it('darkens an overexposed photo toward mid-grey', async () => {
    const mean = await renderFlatGray(240);
    // 240 → 建议 -12。
    expect(mean).toBeCloseTo(228, 0);
    expect(Math.abs(mean - 128)).toBeLessThan(Math.abs(240 - 128));
  });
});

describe('IdPhotoService brightness ordering', () => {
  // one_inch 成片 295×413。源图做成同尺寸，裁剪框正好是整幅、缩放也是恒等变换，
  // 输出像素与输入像素一一对应，便于精确取样。
  const WIDTH = 295;
  const HEIGHT = 413;
  const DARK = 40;
  const RING_ALPHA = 128;
  const RING = 20;

  // 不透明主体 + 一圈 alpha=128 的边缘；边缘 RGB 与整幅暗图一样是 40，
  // 即物理上的存储值 C = F·a + B·(1−a) = 40。
  const OPAQUE = { left: 100, top: 100, width: 95, height: 213 };

  function alphaAt(x: number, y: number): number {
    const inOpaque =
      x >= OPAQUE.left &&
      x < OPAQUE.left + OPAQUE.width &&
      y >= OPAQUE.top &&
      y < OPAQUE.top + OPAQUE.height;
    if (inOpaque) return 255;
    const inRing =
      x >= OPAQUE.left - RING &&
      x < OPAQUE.left + OPAQUE.width + RING &&
      y >= OPAQUE.top - RING &&
      y < OPAQUE.top + OPAQUE.height + RING;
    return inRing ? RING_ALPHA : 0;
  }

  function sampleIndex(x: number, y: number, channels: number): number {
    return (y * WIDTH + x) * channels;
  }

  async function renderWithRing(): Promise<Buffer> {
    const rgb = Buffer.alloc(WIDTH * HEIGHT * 3, DARK);
    const input = await sharp(rgb, {
      raw: { width: WIDTH, height: HEIGHT, channels: 3 },
    })
      .png()
      .toBuffer();

    const mask = Buffer.alloc(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        mask[y * WIDTH + x] = alphaAt(x, y);
      }
    }
    const maskPng = await sharp(mask, {
      raw: { width: WIDTH, height: HEIGHT, channels: 1 },
    })
      .png()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => ({
        mask: maskPng,
        bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
        faceCount: 1,
      }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      // 黑色底：半透明边缘的成片值只由前景 × alpha 决定，便于和两条预期比较。
      backgroundColor: '#000000',
      outputType: 'image/png',
      dpi: 300,
      segmentationMode: 'local',
    });
    return output.buffer;
  }

  it('decontaminates before applying brightness so edges are not amplified by 1/alpha', async () => {
    const buffer = await renderWithRing();
    const { data, info } = await sharp(buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const alpha = new Uint8Array(WIDTH * HEIGHT);
    const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const i = y * WIDTH + x;
        alpha[i] = alphaAt(x, y);
        rgba[i * 4] = DARK;
        rgba[i * 4 + 1] = DARK;
        rgba[i * 4 + 2] = DARK;
        rgba[i * 4 + 3] = alpha[i]!;
      }
    }

    // 服务端底色聚类用未调色的原图，这里同样用原图估计并复用共享去污染。
    const sourceBackground = estimateSourceBackgroundColors(
      Buffer.alloc(WIDTH * HEIGHT * 3, DARK),
      WIDTH,
      HEIGHT
    )[0]!;
    const offset = suggestBrightnessAdjustment(DARK);

    const cleaned = decontaminateIdPhotoForeground(
      rgba,
      WIDTH,
      HEIGHT,
      sourceBackground
    );
    // 正确顺序的预期：去污染 → 调色。
    const correctForeground = (i: number) =>
      Math.min(255, (cleaned[i * 4] ?? 0) + offset);

    // 错误顺序的预期：先调色 → 去污染（反预乘把偏移放大成 offset/a）。
    const preAdjusted = new Uint8ClampedArray(rgba);
    for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
      if (alpha[i] === 0) continue;
      for (let c = 0; c < 3; c += 1) {
        preAdjusted[i * 4 + c] = Math.min(
          255,
          (preAdjusted[i * 4 + c] ?? 0) + offset
        );
      }
    }
    const oldCleaned = decontaminateIdPhotoForeground(
      preAdjusted,
      WIDTH,
      HEIGHT,
      sourceBackground
    );

    // 取外圈像素：距离不透明主体 15px，超过去污染的内边缘阈值 3.5px，
    // alpha 不会被压制；同时远离透明边界，不受重采样污染（此处无缩放）。
    const ringX = OPAQUE.left - 15;
    const ringY = OPAQUE.top + Math.floor(OPAQUE.height / 2);
    const ringI = ringY * WIDTH + ringX;
    const actual = data[sampleIndex(ringX, ringY, info.channels)] ?? 0;
    const correct = Math.round(
      ((correctForeground(ringI) ?? 0) * RING_ALPHA) / 255
    );
    const old = Math.round(((oldCleaned[ringI * 4] ?? 0) * RING_ALPHA) / 255);

    // 旧实现把 k/a ≈ 2k 的反预乘结果叠加到边缘，旧预期明显高于正确预期。
    expect(old - correct).toBeGreaterThan(2);
    // 实际输出应落在「先去污染后调色」的预期附近，而不是旧实现。
    expect(Math.abs(actual - correct)).toBeLessThanOrEqual(1);
    expect(Math.abs(actual - old)).toBeGreaterThanOrEqual(2);

    // 半透明边缘不得比不透明前景更亮（旧实现的 k/a 放大正是亮晕来源）。
    const opaqueX = OPAQUE.left + Math.floor(OPAQUE.width / 2);
    const opaque = data[sampleIndex(opaqueX, ringY, info.channels)] ?? 0;
    expect(actual).toBeLessThanOrEqual(opaque + 1);
  });
});
