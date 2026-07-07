import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import {
  idPhotoPresetSpecs,
  idPhotoTaskConfigSchema,
  type IdPhotoTaskConfig,
} from '@utils-plane/validators';
import { PortraitSegmentationService } from './portrait-segmentation.service';

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

    const mask = await this.segmentation.segment(input);
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

    const alpha = await sharp(mask.mask)
      .resize(preset.widthPx, preset.heightPx, { fit: 'cover' })
      .toBuffer();

    const foreground = await sharp(base).joinChannel(alpha).png().toBuffer();

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
}
