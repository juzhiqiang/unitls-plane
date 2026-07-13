import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import {
  idPhotoPresetSpecs,
  idPhotoTaskConfigSchema,
  type IdPhotoTaskConfig,
} from '@utils-plane/validators';
import {
  PortraitSegmentationService,
  refinePortraitAlphaBytes,
} from './portrait-segmentation.service';

export class IdPhotoError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type IdPhotoRenderResult = {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

type Rgb = { r: number; g: number; b: number };

function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function readRgbAt(rgb: Buffer, index: number): Rgb {
  const pixel = index * 3;
  return {
    r: rgb[pixel] ?? 0,
    g: rgb[pixel + 1] ?? 0,
    b: rgb[pixel + 2] ?? 0,
  };
}

function estimateSourceBackgroundRgb(
  rgb: Buffer,
  width: number,
  height: number
): Rgb {
  const patch = Math.max(
    1,
    Math.min(10, Math.floor(Math.min(width, height) / 8))
  );
  const corners = [
    { x: 0, y: 0 },
    { x: width - patch, y: 0 },
    { x: 0, y: height - patch },
    { x: width - patch, y: height - patch },
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (const corner of corners) {
    for (let y = corner.y; y < corner.y + patch; y += 1) {
      for (let x = corner.x; x < corner.x + patch; x += 1) {
        const index = (y * width + x) * 3;
        r += rgb[index] ?? 0;
        g += rgb[index + 1] ?? 0;
        b += rgb[index + 2] ?? 0;
        count += 1;
      }
    }
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

function hasNearbySolidForeground(
  alpha: Buffer,
  width: number,
  height: number,
  index: number,
  radius = 3
): boolean {
  const x = index % width;
  const y = Math.floor(index / width);

  for (let dy = -radius; dy <= radius; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) {
      continue;
    }
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      if (nx < 0 || nx >= width) {
        continue;
      }
      if ((alpha[ny * width + nx] ?? 0) >= 245) {
        return true;
      }
    }
  }

  return false;
}

function hasNearbyTransparentBackground(
  alpha: Buffer,
  width: number,
  height: number,
  index: number,
  radius = 2
): boolean {
  const x = index % width;
  const y = Math.floor(index / width);

  for (let dy = -radius; dy <= radius; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) {
      continue;
    }
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      if (nx < 0 || nx >= width) {
        continue;
      }
      if ((alpha[ny * width + nx] ?? 0) <= 8) {
        return true;
      }
    }
  }

  return false;
}

function sampleNearbySolidForegroundRgb(
  rgb: Buffer,
  alpha: Buffer,
  width: number,
  height: number,
  index: number,
  radius = 3,
  sourceBackground?: Rgb,
  backgroundLikeThreshold = 80
): Rgb | null {
  const x = index % width;
  const y = Math.floor(index / width);
  let r = 0;
  let g = 0;
  let b = 0;
  let totalWeight = 0;

  for (let dy = -radius; dy <= radius; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) {
      continue;
    }
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      if (nx < 0 || nx >= width) {
        continue;
      }

      const neighbor = ny * width + nx;
      if ((alpha[neighbor] ?? 0) < 245) {
        continue;
      }

      const color = readRgbAt(rgb, neighbor);
      if (
        sourceBackground &&
        colorDistance(color, sourceBackground) < backgroundLikeThreshold
      ) {
        continue;
      }

      const weight = 1 / (dx * dx + dy * dy + 1);
      r += color.r * weight;
      g += color.g * weight;
      b += color.b * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) {
    return null;
  }

  return {
    r: Math.round(r / totalWeight),
    g: Math.round(g / totalWeight),
    b: Math.round(b / totalWeight),
  };
}

function suppressSourceBackgroundFringe(
  alpha: Buffer,
  rgb: Buffer,
  width: number,
  height: number,
  sourceBackground = estimateSourceBackgroundRgb(rgb, width, height)
): Buffer {
  const cleaned = Buffer.from(alpha);
  const colorThreshold = 150;
  const transitionAlpha = 245;

  for (let i = 0; i < cleaned.length; i += 1) {
    const currentAlpha = cleaned[i] ?? 0;
    if (currentAlpha === 0 || currentAlpha > transitionAlpha) {
      continue;
    }
    if (hasNearbySolidForeground(alpha, width, height, i)) {
      continue;
    }

    const distance = colorDistance(readRgbAt(rgb, i), sourceBackground);
    if (distance >= colorThreshold) {
      continue;
    }

    cleaned[i] = Math.round(currentAlpha * (distance / colorThreshold));
  }

  return cleaned;
}

function replaceBackgroundContaminatedEdgeRgb(
  rgb: Buffer,
  alpha: Buffer,
  width: number,
  height: number,
  sourceBackground: Rgb
): Buffer {
  const cleaned = Buffer.from(rgb);
  const backgroundLikeThreshold = 140;
  const boundaryBandRadius = 8;
  const foregroundSampleRadius = 8;
  const replacementMustDifferFromBackground = 80;

  for (let i = 0; i < alpha.length; i += 1) {
    const currentAlpha = alpha[i] ?? 0;
    if (currentAlpha <= 8) {
      continue;
    }
    if (
      !hasNearbyTransparentBackground(
        alpha,
        width,
        height,
        i,
        boundaryBandRadius
      )
    ) {
      continue;
    }

    const color = readRgbAt(rgb, i);
    if (colorDistance(color, sourceBackground) >= backgroundLikeThreshold) {
      continue;
    }

    const replacement = sampleNearbySolidForegroundRgb(
      rgb,
      alpha,
      width,
      height,
      i,
      foregroundSampleRadius,
      sourceBackground
    );
    if (!replacement) {
      continue;
    }
    if (
      colorDistance(replacement, sourceBackground) <
      replacementMustDifferFromBackground
    ) {
      continue;
    }

    const pixel = i * 3;
    cleaned[pixel] = replacement.r;
    cleaned[pixel + 1] = replacement.g;
    cleaned[pixel + 2] = replacement.b;
  }

  return cleaned;
}

function removeUnresolvedBackgroundEdgeAlpha(
  alpha: Buffer,
  sourceAlpha: Buffer,
  rgb: Buffer,
  width: number,
  height: number,
  sourceBackground: Rgb
): Buffer {
  const cleaned = Buffer.from(alpha);
  const backgroundLikeThreshold = 140;
  const boundaryBandRadius = 8;

  for (let i = 0; i < cleaned.length; i += 1) {
    const currentAlpha = cleaned[i] ?? 0;
    if (currentAlpha <= 8) {
      continue;
    }
    const originalAlpha = sourceAlpha[i] ?? currentAlpha;
    if (originalAlpha > 8 && originalAlpha < 245) {
      continue;
    }
    if (
      !hasNearbyTransparentBackground(
        cleaned,
        width,
        height,
        i,
        boundaryBandRadius
      )
    ) {
      continue;
    }

    if (
      colorDistance(readRgbAt(rgb, i), sourceBackground) >=
      backgroundLikeThreshold
    ) {
      continue;
    }

    cleaned[i] = 0;
  }

  return cleaned;
}

function decontaminateForegroundRgb(
  rgb: Buffer,
  alpha: Buffer,
  sourceBackground: Rgb
): Buffer {
  const cleaned = Buffer.from(rgb);
  for (let i = 0; i < alpha.length; i += 1) {
    const currentAlpha = alpha[i] ?? 0;
    if (currentAlpha <= 8 || currentAlpha >= 245) {
      continue;
    }

    const opacity = currentAlpha / 255;
    const pixel = i * 3;
    cleaned[pixel] = Math.max(
      0,
      Math.min(
        255,
        Math.round(
          ((rgb[pixel] ?? 0) - (1 - opacity) * sourceBackground.r) / opacity
        )
      )
    );
    cleaned[pixel + 1] = Math.max(
      0,
      Math.min(
        255,
        Math.round(
          ((rgb[pixel + 1] ?? 0) - (1 - opacity) * sourceBackground.g) / opacity
        )
      )
    );
    cleaned[pixel + 2] = Math.max(
      0,
      Math.min(
        255,
        Math.round(
          ((rgb[pixel + 2] ?? 0) - (1 - opacity) * sourceBackground.b) / opacity
        )
      )
    );
  }

  return cleaned;
}

@Injectable()
export class IdPhotoService {
  constructor(private readonly segmentation: PortraitSegmentationService) {}

  async render(
    input: Buffer,
    rawConfig: IdPhotoTaskConfig
  ): Promise<IdPhotoRenderResult> {
    const config = idPhotoTaskConfigSchema.parse(rawConfig);
    const preset = idPhotoPresetSpecs[config.preset];
    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height) {
      throw new IdPhotoError(
        'ID_PHOTO_RENDER_FAILED',
        'File is not a valid image'
      );
    }

    const renderIdPhoto = this.segmentation.renderIdPhoto?.bind(
      this.segmentation
    );
    if (config.segmentationMode === 'ai' && renderIdPhoto) {
      const aiResult = await renderIdPhoto(input, {
        width: preset.widthPx,
        height: preset.heightPx,
        backgroundColor: config.backgroundColor,
        outputType: config.outputType,
      });
      if (aiResult?.length) {
        return this.encodeFinalResult(aiResult, config);
      }
    }

    const mask = await this.segmentation.segment(input, {
      mode: config.segmentationMode,
    });
    if (mask.faceCount === 0) {
      throw new IdPhotoError('NO_FACE_DETECTED', 'No face detected');
    }
    if ((mask.faceCount ?? 1) > 1) {
      throw new IdPhotoError(
        'MULTIPLE_FACES_DETECTED',
        'Multiple faces detected'
      );
    }
    if (!mask.mask.length) {
      throw new IdPhotoError(
        'SEGMENTATION_FAILED',
        'Portrait segmentation failed'
      );
    }

    const base = await sharp(input)
      .rotate()
      .resize({
        width: preset.widthPx,
        height: preset.heightPx,
        fit: 'cover',
        position: 'centre',
      })
      .toBuffer();

    const resizedAlpha = await sharp(mask.mask)
      .resize(preset.widthPx, preset.heightPx, { fit: 'cover' })
      .greyscale()
      .raw()
      .toBuffer();
    const baseRgb = await sharp(base).removeAlpha().raw().toBuffer();
    const refinedAlpha = refinePortraitAlphaBytes(resizedAlpha);
    const sourceBackground = estimateSourceBackgroundRgb(
      baseRgb,
      preset.widthPx,
      preset.heightPx
    );
    const cleanedAlpha = suppressSourceBackgroundFringe(
      refinedAlpha,
      baseRgb,
      preset.widthPx,
      preset.heightPx,
      sourceBackground
    );
    const decontaminatedRgb = decontaminateForegroundRgb(
      baseRgb,
      cleanedAlpha,
      sourceBackground
    );
    const foregroundRgb = replaceBackgroundContaminatedEdgeRgb(
      decontaminatedRgb,
      cleanedAlpha,
      preset.widthPx,
      preset.heightPx,
      sourceBackground
    );
    const finalAlpha = removeUnresolvedBackgroundEdgeAlpha(
      cleanedAlpha,
      resizedAlpha,
      foregroundRgb,
      preset.widthPx,
      preset.heightPx,
      sourceBackground
    );
    const alpha = await sharp(finalAlpha, {
      raw: { width: preset.widthPx, height: preset.heightPx, channels: 1 },
    })
      .png()
      .toBuffer();

    const foregroundBase = await sharp(foregroundRgb, {
      raw: { width: preset.widthPx, height: preset.heightPx, channels: 3 },
    })
      .png()
      .toBuffer();
    const foreground = await sharp(foregroundBase)
      .joinChannel(alpha)
      .png()
      .toBuffer();

    const background = sharp({
      create: {
        width: preset.widthPx,
        height: preset.heightPx,
        channels: 3,
        background: hexToRgb(config.backgroundColor),
      },
    })
      .png()
      .composite([{ input: foreground, blend: 'over' }]);

    if (config.outputType === 'image/png') {
      return {
        buffer: await background.png({ compressionLevel: 9 }).toBuffer(),
        mimeType: 'image/png',
        extension: 'png',
      };
    }

    return {
      buffer: await background.jpeg({ quality: 92, mozjpeg: true }).toBuffer(),
      mimeType: 'image/jpeg',
      extension: 'jpg',
    };
  }

  private async encodeFinalResult(
    input: Buffer,
    config: IdPhotoTaskConfig
  ): Promise<IdPhotoRenderResult> {
    const preset = idPhotoPresetSpecs[config.preset];
    const image = sharp(input)
      .rotate()
      .resize({
        width: preset.widthPx,
        height: preset.heightPx,
        fit: 'cover',
        position: 'centre',
        background: hexToRgb(config.backgroundColor),
      });

    if (config.outputType === 'image/png') {
      return {
        buffer: await image.png({ compressionLevel: 9 }).toBuffer(),
        mimeType: 'image/png',
        extension: 'png',
      };
    }

    return {
      buffer: await image
        .flatten({ background: hexToRgb(config.backgroundColor) })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer(),
      mimeType: 'image/jpeg',
      extension: 'jpg',
    };
  }
}
