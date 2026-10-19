import { Injectable, Optional } from '@nestjs/common';
import sharp from 'sharp';
import {
  estimateSourceBackgroundColors,
  idPhotoPresetSpecs,
  idPhotoTaskConfigSchema,
  inspectIdPhoto,
  idPhotoCropFromLayout,
  resolveIdPhotoCropBox,
  suggestIdPhotoLayout,
  type IdPhotoTaskConfig,
  type QualityReport,
} from '@utils-plane/validators';
import { decontaminateIdPhotoForeground } from '@utils-plane/utils';
import { FaceDetectionService } from './face-detection.service';
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
  /** 质量检查报告；前端结果页据此渲染面板。 */
  quality?: QualityReport;
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
  constructor(
    private readonly segmentation: PortraitSegmentationService,
    @Optional() private readonly faces?: FaceDetectionService
  ) {}

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

    // base 与 mask 必须用同一个裁剪框,否则前景与 alpha 会错位。crop 归一化到各自
    // 尺寸,mask 已被 segment() resize 回输入尺寸,两者一致。
    const oriented = await sharp(input).rotate().toBuffer();
    const orientedMeta = await sharp(oriented).metadata();
    const sourceWidth = orientedMeta.width ?? metadata.width;
    const sourceHeight = orientedMeta.height ?? metadata.height;

    // 裁剪优先级：显式 crop > 人脸自动构图 > 居中
    const detected = (await this.faces?.detect(oriented)) ?? [];
    const face = detected[0] ?? null;
    let crop = config.crop;
    let rotation = 0;
    if (!crop && face) {
      const layout = suggestIdPhotoLayout(
        face,
        { width: sourceWidth, height: sourceHeight },
        preset.widthPx / preset.heightPx,
        await this.detectCrownY(mask.mask)
      );
      if (layout) {
        crop = idPhotoCropFromLayout(
          layout,
          { width: sourceWidth, height: sourceHeight },
          preset.widthPx / preset.heightPx
        );
        rotation = layout.rotation;
      }
    }

    const baseBox = resolveIdPhotoCropBox(
      sourceWidth,
      sourceHeight,
      preset.widthPx,
      preset.heightPx,
      crop
    );

    const base = await sharp(oriented)
      .extract(baseBox)
      .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize({
        width: preset.widthPx,
        height: preset.heightPx,
        fit: 'cover',
        position: 'centre',
      })
      .toBuffer();

    const maskMeta = await sharp(mask.mask).metadata();
    const maskBox = resolveIdPhotoCropBox(
      maskMeta.width ?? sourceWidth,
      maskMeta.height ?? sourceHeight,
      preset.widthPx,
      preset.heightPx,
      crop
    );

    const resizedAlpha = await sharp(mask.mask)
      .extract(maskBox)
      .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(preset.widthPx, preset.heightPx, { fit: 'cover' })
      .greyscale()
      .raw()
      .toBuffer();

    const baseRgbRaw = await sharp(base).removeAlpha().raw().toBuffer();

    // 底色聚类（替换原四角均值），取出现频次最高的那个
    const candidates = estimateSourceBackgroundColors(
      baseRgbRaw,
      preset.widthPx,
      preset.heightPx
    );
    const sourceBackground = candidates[0] ?? { r: 0, g: 0, b: 0 };

    // 共享纯函数做去污染，返回 RGBA
    const rgba = new Uint8ClampedArray(preset.widthPx * preset.heightPx * 4);
    for (let i = 0; i < preset.widthPx * preset.heightPx; i += 1) {
      rgba[i * 4] = baseRgbRaw[i * 3] ?? 0;
      rgba[i * 4 + 1] = baseRgbRaw[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = baseRgbRaw[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = resizedAlpha[i] ?? 0;
    }
    const cleaned = decontaminateIdPhotoForeground(
      rgba,
      preset.widthPx,
      preset.heightPx,
      sourceBackground
    );

    const foregroundRgb = Buffer.alloc(preset.widthPx * preset.heightPx * 3);
    const finalAlpha = Buffer.alloc(preset.widthPx * preset.heightPx);
    for (let i = 0; i < preset.widthPx * preset.heightPx; i += 1) {
      foregroundRgb[i * 3] = cleaned[i * 4] ?? 0;
      foregroundRgb[i * 3 + 1] = cleaned[i * 4 + 1] ?? 0;
      foregroundRgb[i * 3 + 2] = cleaned[i * 4 + 2] ?? 0;
      finalAlpha[i] = cleaned[i * 4 + 3] ?? 0;
    }

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

    // 质量检查在最终成片上做，faceCount 用真实检测结果
    const quality = inspectIdPhoto({
      rgb: baseRgbRaw,
      width: preset.widthPx,
      height: preset.heightPx,
      face,
      faceCount: detected.length,
      alpha: finalAlpha,
    });

    if (config.outputType === 'image/png') {
      return {
        buffer: await background
          .png({ compressionLevel: 9 })
          .withMetadata({ density: 300 })
          .toBuffer(),
        mimeType: 'image/png',
        extension: 'png',
        quality,
      };
    }

    return {
      buffer: await background
        .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .withMetadata({ density: 300 })
        .toBuffer(),
      mimeType: 'image/jpeg',
      extension: 'jpg',
      quality,
    };
  }

  /**
   * 从分割蒙版取真实头顶（前景最高行）。
   *
   * YuNet 的人脸框起点在发际线附近，不是头顶；用它算头顶留白会偏小。
   * 蒙版不可用时返回 undefined，`suggestIdPhotoLayout` 会自动退回估算。
   */
  private async detectCrownY(maskPng: Buffer): Promise<number | undefined> {
    try {
      const { data, info } = await sharp(maskPng)
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          if ((data[y * info.width + x] ?? 0) > 96) return y;
        }
      }
    } catch {
      // 蒙版读不出来不影响出图
    }
    return undefined;
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
        buffer: await image
          .png({ compressionLevel: 9 })
          .withMetadata({ density: 300 })
          .toBuffer(),
        mimeType: 'image/png',
        extension: 'png',
      };
    }

    return {
      buffer: await image
        .flatten({ background: hexToRgb(config.backgroundColor) })
        .jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .withMetadata({ density: 300 })
        .toBuffer(),
      mimeType: 'image/jpeg',
      extension: 'jpg',
    };
  }
}
