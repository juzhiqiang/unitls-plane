import { Injectable, Optional } from '@nestjs/common';
import sharp from 'sharp';
import {
  estimateSourceBackgroundColors,
  idPhotoPresetSpecs,
  idPhotoTaskConfigSchema,
  inspectIdPhoto,
  idPhotoCropFromLayout,
  mapFaceToOutput,
  resolveIdPhotoCropBox,
  suggestBrightnessAdjustment,
  suggestIdPhotoLayout,
  type IdPhotoTaskConfig,
  type QualityReport,
} from '@utils-plane/validators';
import {
  computeForegroundMeanBrightness,
  decontaminateIdPhotoForeground,
} from '@utils-plane/utils';
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

    // 注意：sharp 在同一 pipeline 内按固定顺序执行 rotate → extract → resize，
    // 与调用顺序无关。这里必须先单独 extract，再对新 buffer 旋转，才能得到
    // 「先裁剪、再绕裁剪框中心回正」的几何 —— 与本地 canvas 的
    // `ctx.rotate(-rotation)` 一致，且与 mapFaceToOutput 的映射公式一致。
    const baseCropped = await sharp(oriented).extract(baseBox).toBuffer();
    const base = await sharp(baseCropped)
      // sharp 的 rotate 正值是顺时针；layout.rotation 正值表示右眼更低，
      // 需要逆时针回正，因此取负。
      .rotate(-rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
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

    const alphaCropped = await sharp(mask.mask).extract(maskBox).toBuffer();
    const resizedAlpha = await sharp(alphaCropped)
      .rotate(-rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(preset.widthPx, preset.heightPx, { fit: 'cover' })
      .greyscale()
      .raw()
      .toBuffer();

    const baseRgbRaw = await sharp(base).removeAlpha().raw().toBuffer();
    const pixelCount = preset.widthPx * preset.heightPx;

    // 底色聚类必须用**未调色、未旋转**的原图裁剪：
    // - 未调色：亮度是前景校正，若先把偏移加到全幅再聚类，会把估计出的底色
    //   整体推亮/推暗，进而影响去污染的反预乘结果；
    // - 未旋转：`rotate(-rotation)` 会为四角补透明像素，边缘取样会把补出的
    //   黑角算进底色。本地路是从未旋转原图按同一裁剪框取样的，服务端保持
    //   同一语义，旋转照片的边缘底色才不会出现两端不一致。
    const baseUnrotatedRgbRaw = await sharp(baseCropped)
      .resize({
        width: preset.widthPx,
        height: preset.heightPx,
        fit: 'cover',
        position: 'centre',
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    const candidates = estimateSourceBackgroundColors(
      baseUnrotatedRgbRaw,
      preset.widthPx,
      preset.heightPx
    );
    const sourceBackground = candidates[0] ?? { r: 0, g: 0, b: 0 };

    // 共享纯函数做去污染，返回 RGBA。
    //
    // 必须先把**未调色**的前景 + alpha 交给去污染，再对结果调色：反预乘
    // `(C - bg(1-a))/a` 会把任何人工偏移放大成 `k/a`。若先调色，a≈0.5 的边缘
    // 偏移会翻倍，暗片出现亮晕、过曝片出现暗边，且与本地 canvas 路
    // （先去污染后调色）结果不一致。
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0; i < pixelCount; i += 1) {
      rgba[i * 4] = baseRgbRaw[i * 3] ?? 0;
      rgba[i * 4 + 1] = baseRgbRaw[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = baseRgbRaw[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = resizedAlpha[i] ?? 0;
    }

    // 亮度自动校正与本地路同一口径：在裁剪并缩放到成片尺寸的 RGBA 上、
    // 只统计 alpha > 0 的前景像素，使用共享的均值函数与偏移算法。
    // 用户显式指定 crop 时不做自动调色（尊重用户构图），对应本地的
    // `autoFrame && !userOverride`。
    const brightnessOffset = config.crop
      ? 0
      : suggestBrightnessAdjustment(
          computeForegroundMeanBrightness(rgba, preset.widthPx, preset.heightPx)
        );

    const cleaned = decontaminateIdPhotoForeground(
      rgba,
      preset.widthPx,
      preset.heightPx,
      sourceBackground
    );

    // 从去污染结果提取前景 RGB 与 alpha，然后才应用亮度：加法偏移只作用于
    // alpha > 0 的像素；去污染把内边缘 alpha 压到 0 的像素也不再调色。
    const foregroundRgb = Buffer.alloc(preset.widthPx * preset.heightPx * 3);
    const finalAlpha = Buffer.alloc(preset.widthPx * preset.heightPx);
    for (let i = 0; i < preset.widthPx * preset.heightPx; i += 1) {
      foregroundRgb[i * 3] = cleaned[i * 4] ?? 0;
      foregroundRgb[i * 3 + 1] = cleaned[i * 4 + 1] ?? 0;
      foregroundRgb[i * 3 + 2] = cleaned[i * 4 + 2] ?? 0;
      finalAlpha[i] = cleaned[i * 4 + 3] ?? 0;
    }
    if (brightnessOffset !== 0) {
      for (let i = 0; i < pixelCount; i += 1) {
        if ((finalAlpha[i] ?? 0) === 0) continue;
        for (let c = 0; c < 3; c += 1) {
          foregroundRgb[i * 3 + c] = Math.max(
            0,
            Math.min(255, (foregroundRgb[i * 3 + c] ?? 0) + brightnessOffset)
          );
        }
      }
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

    // 质量检查必须基于**最终成片**的像素：去污染 + 调色后的前景已经叠到
    // 新底色上，alpha=0 的区域此时是新背景色，而不是原图底色。只传去污染后
    // 的前景 RGB 会让曝光/清晰度按「透明区仍是原背景」判定，与本地路不一致。
    const composed = await background
      .clone()
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 质量检查在最终成片上做。人脸框/关键点是源图坐标，必须先映射到成片坐标，
    // 否则 faceRatio、faceCentered、headroom 会按源图尺寸计算而失真。
    const quality = inspectIdPhoto({
      rgb: composed.data,
      width: preset.widthPx,
      height: preset.heightPx,
      face: face ? mapFaceToOutput(face, baseBox, preset, rotation) : null,
      // YuNet 不可用时不能回退 mask.faceCount：分割服务的该值恒为 1，
      // 会让「检测不可用」被误判为「恰好一张脸」。与本地路一致按 0 处理。
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
      // 只认「像一条头顶边缘」的行：至少 3 个像素且不少于宽度的 2%。
      // 否则顶部零星噪点会把构图整体上移。
      const minForeground = Math.max(3, info.width * 0.02);
      for (let y = 0; y < info.height; y += 1) {
        let foreground = 0;
        for (let x = 0; x < info.width; x += 1) {
          if ((data[y * info.width + x] ?? 0) > 96) foreground += 1;
        }
        if (foreground >= minForeground) return y;
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
