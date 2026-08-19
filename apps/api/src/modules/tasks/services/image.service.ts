import { Injectable, OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import {
  resolveWatermarkAnchor,
  type ImageWatermarkPosition as SharedWatermarkPosition,
} from '@utils-plane/validators';

export interface CompressOptions {
  format?: 'jpeg' | 'webp' | 'avif' | 'png';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** 目标体积上限(KB)。传入时按该上限迭代降质/降分辨率,不传则只按 quality 编码。 */
  maxSizeKB?: number;
  /**
   * 保留 EXIF/ICC/XMP 等元数据。默认 false —— sharp 不调 withMetadata 就会全部丢弃,
   * 这也是我们希望的默认行为(不把 GPS 定位和设备信息带进产出)。
   */
  preserveExif?: boolean;
  transform?: ImageTransformOptions;
}

export interface ConvertOptions {
  toFormat: 'jpeg' | 'png' | 'webp' | 'avif';
  quality?: number;
  lossless?: boolean;
  transform?: ImageTransformOptions;
}

export interface ImageTransformOptions {
  autoOrient?: boolean;
  rotate?: 0 | 90 | 180 | 270;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

export type ImageWatermarkPosition = SharedWatermarkPosition;

export interface WatermarkOptions {
  text: string;
  position?: ImageWatermarkPosition;
  fontSize?: number;
  opacity?: number;
  color?: { r: number; g: number; b: number };
  rotation?: number;
  margin?: number;
  /** 给文字描一圈反色边,浅色底图上也能读。 */
  outline?: boolean;
  outputFormat?: 'jpeg' | 'png' | 'webp' | 'avif';
  quality?: number;
  transform?: ImageTransformOptions;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function applyImageTransform(
  pipeline: ReturnType<typeof sharp>,
  opts?: ImageTransformOptions
): ReturnType<typeof sharp> {
  if (!opts) return pipeline;

  let transformed = opts.autoOrient === false ? pipeline : pipeline.rotate();
  if (opts.rotate !== undefined && opts.rotate !== 0) {
    transformed = transformed.rotate(opts.rotate);
  }
  if (opts.flipHorizontal) {
    transformed = transformed.flop();
  }
  if (opts.flipVertical) {
    transformed = transformed.flip();
  }
  return transformed;
}

/**
 * 元数据策略。
 *
 * sharp 默认丢弃全部元数据,只有显式 withMetadata() 才保留。保留是安全的:
 * 实测 rotate() 自动纠正方向后再 withMetadata(),sharp 会把旋转烘进像素并把
 * orientation 重置为 1,不会因为带回原 orientation 标签而二次旋转。
 */
function applyMetadataPolicy(
  pipeline: ReturnType<typeof sharp>,
  preserveExif?: boolean
): ReturnType<typeof sharp> {
  return preserveExif ? pipeline.withMetadata() : pipeline;
}

/** SVG 的 dominant-baseline 取值,与共享锚点的垂直对齐对应。 */
function svgBaselineOf(vertical: 'top' | 'middle' | 'bottom'): string {
  if (vertical === 'top') return 'hanging';
  if (vertical === 'bottom') return 'auto';
  return 'middle';
}

function buildWatermarkSvg(
  width: number,
  height: number,
  opts: Required<
    Pick<
      WatermarkOptions,
      | 'text'
      | 'position'
      | 'fontSize'
      | 'opacity'
      | 'color'
      | 'rotation'
      | 'margin'
    >
  > &
    Pick<WatermarkOptions, 'outline'>
): string {
  const text = escapeXml(opts.text);
  const fill = `rgb(${opts.color.r}, ${opts.color.g}, ${opts.color.b})`;
  // 描边取正反色:亮字配深边、暗字配亮边,与本地 outlineColorFor 同一套判定。
  const luma =
    (opts.color.r * 299 + opts.color.g * 587 + opts.color.b * 114) / 1000;
  const shade = luma > 140 ? 0 : 255;
  const strokeAttrs = opts.outline
    ? ` stroke="rgb(${shade}, ${shade}, ${shade})" stroke-opacity="${opts.opacity * 0.85}" stroke-width="${Math.max(1, opts.fontSize / 12)}" stroke-linejoin="round" paint-order="stroke"`
    : '';
  const common = `font-family="Arial, Helvetica, sans-serif" font-size="${opts.fontSize}" font-weight="700" fill="${fill}" fill-opacity="${opts.opacity}"${strokeAttrs}`;

  if (opts.position === 'tile') {
    const tileWidth = Math.max(180, opts.text.length * opts.fontSize * 0.7);
    const tileHeight = Math.max(120, opts.fontSize * 3.5);
    return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="watermark" width="${tileWidth}" height="${tileHeight}" patternUnits="userSpaceOnUse" patternTransform="rotate(${opts.rotation})">
      <text x="${tileWidth / 2}" y="${tileHeight / 2}" text-anchor="middle" dominant-baseline="middle" ${common}>${text}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#watermark)" />
</svg>`;
  }

  // 锚点走 validators 的共享解算:本地 canvas 与这里必须落在同一个坐标上。
  const anchor = resolveWatermarkAnchor(
    opts.position,
    width,
    height,
    opts.margin
  );
  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${anchor.x}" y="${anchor.y}" text-anchor="${anchor.horizontal}" dominant-baseline="${svgBaselineOf(anchor.vertical)}" transform="rotate(${opts.rotation} ${anchor.x} ${anchor.y})" ${common}>${text}</text>
</svg>`;
}

/** 目标体积模式的搜索边界。 */
const TARGET_SIZE_MIN_KB = 10;
const TARGET_SIZE_MAX_KB = 20 * 1024;
const TARGET_SIZE_MIN_QUALITY = 10;
/** 逐级降采样的宽度比例;质量已到底仍超标时才会用到。 */
const TARGET_SIZE_SCALE_STEPS = [1, 0.8, 0.64, 0.5, 0.4, 0.32, 0.25];
/** PNG 无损,只能靠调色板色数与降采样控体积。 */
const TARGET_SIZE_PNG_COLORS = [256, 128, 64, 32, 16];

@Injectable()
export class ImageService implements OnModuleInit {
  onModuleInit() {
    sharp.cache(false);
  }
  async compress(input: Buffer, opts: CompressOptions): Promise<Buffer> {
    if (opts.maxSizeKB !== undefined) {
      return this.compressToTargetSize(input, opts);
    }

    const buf = Buffer.from(input);
    let pipeline = applyImageTransform(
      sharp(buf, { failOn: 'truncated' }),
      opts.transform
    );

    if (opts.maxWidth || opts.maxHeight) {
      pipeline = pipeline.resize({
        width: opts.maxWidth,
        height: opts.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    pipeline = applyMetadataPolicy(pipeline, opts.preserveExif);

    switch (opts.format ?? 'jpeg') {
      case 'jpeg':
        return pipeline
          .jpeg({ quality: opts.quality ?? 80, mozjpeg: true })
          .toBuffer();
      case 'webp':
        return pipeline.webp({ quality: opts.quality ?? 80 }).toBuffer();
      case 'avif':
        return pipeline.avif({ quality: opts.quality ?? 60 }).toBuffer();
      case 'png':
        return pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
      default:
        throw new Error(`Unsupported format: ${opts.format}`);
    }
  }

  /**
   * 压缩到目标体积以内。
   *
   * 每次尝试都从原始 buffer 重建 pipeline,而不是复用上一轮的编码结果 —— 复用会让
   * 有损格式的画质损失逐轮叠加。代价是多几次解码,对队列任务可以接受。
   *
   * 搜索策略:先在原始尺寸上二分质量;质量到底仍超标才逐级降采样,且每一级先用最低
   * 质量试探一次,试探都放不下就直接跳到下一级,避免在不可能的尺度上做完整二分。
   *
   * 目标确实无法达成时(例如极小目标 + 超大图),返回过程中体积最小的一版,而不是让
   * 任务失败 —— 与本地模式 browser-image-compression 的尽力而为行为保持一致。
   */
  private async compressToTargetSize(
    input: Buffer,
    opts: CompressOptions
  ): Promise<Buffer> {
    const format = opts.format ?? 'jpeg';
    const targetBytes =
      clamp(
        Math.round(opts.maxSizeKB ?? TARGET_SIZE_MAX_KB),
        TARGET_SIZE_MIN_KB,
        TARGET_SIZE_MAX_KB
      ) * 1024;
    const initialQuality = clamp(
      Math.round(opts.quality ?? 92),
      TARGET_SIZE_MIN_QUALITY,
      100
    );

    const metadata = await sharp(input, { failOn: 'truncated' }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('File is not a valid image');
    }
    // 方向修正会交换宽高,基准宽度必须取修正之后的值。
    const swapsAxes =
      opts.transform?.rotate === 90 || opts.transform?.rotate === 270;
    const orientedWidth = swapsAxes ? metadata.height : metadata.width;
    // maxHeight 只在等比缩放下间接约束宽度,交给 render 里的 fit:inside 处理。
    const boundedWidth = Math.min(
      orientedWidth,
      opts.maxWidth ?? orientedWidth
    );

    let smallest: Buffer | undefined;
    const render = async (
      quality: number,
      width: number,
      colors?: number
    ): Promise<Buffer> => {
      let pipeline = applyMetadataPolicy(
        applyImageTransform(
          sharp(input, { failOn: 'truncated' }),
          opts.transform
        ).resize({
          width,
          height: opts.maxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        }),
        opts.preserveExif
      );

      switch (format) {
        case 'jpeg':
          pipeline = pipeline.jpeg({ quality, mozjpeg: true });
          break;
        case 'webp':
          pipeline = pipeline.webp({ quality });
          break;
        case 'avif':
          pipeline = pipeline.avif({ quality, effort: 4 });
          break;
        case 'png':
          pipeline = pipeline.png({
            compressionLevel: 9,
            palette: true,
            colors: colors ?? 256,
          });
          break;
        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      const output = await pipeline.toBuffer();
      if (!smallest || output.length < smallest.length) {
        smallest = output;
      }
      return output;
    };

    for (const scale of TARGET_SIZE_SCALE_STEPS) {
      const width = Math.max(16, Math.round(boundedWidth * scale));

      if (format === 'png') {
        for (const colors of TARGET_SIZE_PNG_COLORS) {
          const output = await render(initialQuality, width, colors);
          if (output.length <= targetBytes) return output;
        }
        continue;
      }

      // 先用最低质量探底:放不下说明这个尺度不可能达标,直接降采样。
      const probe = await render(TARGET_SIZE_MIN_QUALITY, width);
      if (probe.length > targetBytes) continue;

      // 该尺度可行,二分找出满足目标的最高质量。
      let lo = TARGET_SIZE_MIN_QUALITY;
      let hi = initialQuality;
      let best = probe;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const output = await render(mid, width);
        if (output.length <= targetBytes) {
          best = output;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best;
    }

    return smallest ?? (await render(TARGET_SIZE_MIN_QUALITY, boundedWidth));
  }

  async convert(input: Buffer, opts: ConvertOptions): Promise<Buffer> {
    const pipeline = applyImageTransform(
      sharp(input, { failOn: 'truncated' }),
      opts.transform
    );

    switch (opts.toFormat) {
      case 'jpeg':
        return pipeline
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: opts.quality ?? 90, mozjpeg: true })
          .toBuffer();
      case 'png':
        return pipeline.png({ compressionLevel: 9 }).toBuffer();
      case 'webp':
        return pipeline
          .webp({
            quality: opts.quality ?? 90,
            lossless: opts.lossless ?? false,
          })
          .toBuffer();
      case 'avif':
        return pipeline
          .avif({ quality: opts.quality ?? 70, effort: 4 })
          .toBuffer();
      default:
        throw new Error(`Unsupported format: ${opts.toFormat}`);
    }
  }

  async watermark(input: Buffer, opts: WatermarkOptions): Promise<Buffer> {
    const text = opts.text?.trim();
    if (!text) {
      throw new Error('Watermark text is required');
    }

    const transformedInput = await applyImageTransform(
      sharp(input, { failOn: 'truncated' }),
      opts.transform
    ).toBuffer();

    const image = sharp(transformedInput, { failOn: 'truncated' });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('File is not a valid image');
    }

    const fontSize = clamp(opts.fontSize ?? 48, 8, 240);
    const opacity = clamp(opts.opacity ?? 0.3, 0.05, 1);
    const color = opts.color ?? { r: 128, g: 128, b: 128 };
    const position = opts.position ?? 'tile';
    const rotation = opts.rotation ?? (position === 'tile' ? -30 : 0);
    const margin = clamp(
      opts.margin ?? 32,
      0,
      Math.max(metadata.width, metadata.height)
    );
    const safeColor = {
      r: clamp(Math.round(color.r), 0, 255),
      g: clamp(Math.round(color.g), 0, 255),
      b: clamp(Math.round(color.b), 0, 255),
    };

    const svg = buildWatermarkSvg(metadata.width, metadata.height, {
      text,
      position,
      fontSize,
      opacity,
      color: safeColor,
      rotation,
      margin,
      outline: opts.outline,
    });

    let pipeline = sharp(transformedInput, { failOn: 'truncated' }).composite([
      { input: Buffer.from(svg), blend: 'over' },
    ]);

    const outputFormat =
      opts.outputFormat ??
      (metadata.format as WatermarkOptions['outputFormat']) ??
      'jpeg';
    switch (outputFormat) {
      case 'png':
        return pipeline.png({ compressionLevel: 9 }).toBuffer();
      case 'webp':
        return pipeline.webp({ quality: opts.quality ?? 90 }).toBuffer();
      case 'avif':
        return pipeline
          .avif({ quality: opts.quality ?? 70, effort: 4 })
          .toBuffer();
      case 'jpeg':
      default:
        return pipeline
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: opts.quality ?? 90, mozjpeg: true })
          .toBuffer();
    }
  }

  async getMetadata(input: Buffer) {
    return sharp(input).metadata();
  }
}
