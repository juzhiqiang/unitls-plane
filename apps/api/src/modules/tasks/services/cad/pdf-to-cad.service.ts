import { Injectable } from '@nestjs/common';
import type { PdfToCadTaskConfig } from '@utils-plane/validators';
import {
  createCadWriter,
  packageCadWriteResult,
  type PackagedCadOutput,
} from './cad-writer';
import { sanitizeFileName } from './dxf-writer';
import { LayerMapper } from './layer-mapper';
import {
  loadMupdf,
  PdfCadExtractorService,
  recomputeConversionMeta,
} from './pdf-cad-extractor.service';
import {
  inferRasterLines,
  OCR_RENDER_DPI,
  pageUnitFactor,
  rasterLinesToEntities,
  renderPageRaster,
} from './raster-underlay';
import { ocrLinesToEntities, TesseractOcr } from './tesseract-ocr';
import {
  CadError,
  countEntity,
  type CadConversionMeta,
  type CadDocument,
  type CadEntity,
  type CadPage,
} from './types';

/**
 * PDF → CAD 的阶段编排(解析 → 扫描页识别 → 写出 → 打包)。
 *
 * 处理器只负责文件、进度与任务状态;所有契约错误(DWG 未支持、OCR 不可用、配置非法、
 * 转换失败)都在这里以 CadError 抛出,并且在做任何重活之前先做前置检查,避免产出伪成功文件。
 */

export type ConversionStage = 'parse' | 'ocr' | 'write';

export interface ConvertOptions {
  /** 输出文件基名(不含扩展名)。 */
  baseName?: string;
  onProgress?: (
    stage: ConversionStage,
    fraction: number
  ) => void | Promise<void>;
  /** 可注入的 OCR 引擎(测试用假 runner);缺省按环境变量构造。 */
  ocr?: TesseractOcr;
  maxEntities?: number;
}

export interface PdfToCadResult {
  output: PackagedCadOutput;
  document: CadDocument;
  meta: CadConversionMeta;
}

@Injectable()
export class PdfToCadService {
  constructor(private readonly extractor: PdfCadExtractorService) {}

  async convert(
    pdf: Buffer,
    config: PdfToCadTaskConfig,
    options: ConvertOptions = {}
  ): Promise<PdfToCadResult> {
    const baseName = sanitizeFileName(options.baseName ?? 'drawing');
    if (config.format === 'dwg') {
      throw new CadError(
        'CAD_DWG_UNSUPPORTED',
        'DWG output is not available yet; export DXF instead'
      );
    }
    const writer = createCadWriter(config.format, { baseName });

    // OCR 是可选能力,但一旦要求就必须真的可用:缺可执行文件或语言包直接失败,不做静默跳过。
    const ocr = config.ocr ? (options.ocr ?? new TesseractOcr()) : null;
    if (ocr) await ocr.ensureAvailable();

    const document = await this.extractor.extract(pdf, config, {
      resourceBaseName: baseName,
      maxEntities: options.maxEntities,
      onProgress: (done, total) => options.onProgress?.('parse', done / total),
    });

    if (ocr) {
      await this.recognizeScannedPages(pdf, document, config, ocr, options);
    }
    recomputeConversionMeta(document);

    await options.onProgress?.('write', 0);
    const result = await writer.write(document);
    const output = await packageCadWriteResult(result);
    await options.onProgress?.('write', 1);

    return { output, document, meta: document.meta };
  }

  /**
   * 扫描页识别:只处理没有原生文字的含图页面。
   * - 纯图片页(raster):Tesseract 识别文字 + 栅格直线推断;
   * - 有图片也有矢量但没有文字(mixed):只做 OCR,矢量线已经是原生的;
   * - 有原生文字的含图页:跳过并记录 ocr_skipped_native_text,避免文字重复。
   */
  private async recognizeScannedPages(
    pdf: Buffer,
    document: CadDocument,
    config: PdfToCadTaskConfig,
    ocr: TesseractOcr,
    options: ConvertOptions
  ): Promise<void> {
    const candidates = document.pages.filter(page => page.stats.imageCount > 0);
    if (candidates.length === 0) {
      await options.onProgress?.('ocr', 1);
      return;
    }
    const layers = new LayerMapper(config.layerMode);
    const ocrLayer = layers.resolve({ origin: 'ocr', source: 'ocr' });
    const rasterLayer = layers.resolve({
      origin: 'raster',
      source: 'inferred',
    });
    const unitFactor = pageUnitFactor(document);

    const mupdf = await loadMupdf();
    const source = mupdf.Document.openDocument(pdf, 'application/pdf');
    try {
      for (let i = 0; i < candidates.length; i++) {
        const page = candidates[i]!;
        if (page.stats.textCharCount > 0) {
          document.meta.degradations.push({
            code: 'ocr_skipped_native_text',
            page: page.number,
          });
          await options.onProgress?.('ocr', (i + 1) / candidates.length);
          continue;
        }

        const mupdfPage = source.loadPage(page.index);
        let raster;
        try {
          raster = renderPageRaster(mupdf, mupdfPage, OCR_RENDER_DPI);
        } finally {
          mupdfPage.destroy();
        }

        if (page.kind === 'raster') {
          const lines = rasterLinesToEntities(
            inferRasterLines(raster),
            page,
            raster,
            unitFactor,
            rasterLayer
          );
          if (lines.length > 0) {
            for (const line of lines) addEntity(page, line);
            document.meta.degradations.push({
              code: 'raster_lines_inferred',
              page: page.number,
              count: lines.length,
            });
          }
        }

        const recognized = await ocr.recognize(raster.png);
        const texts = ocrLinesToEntities(
          recognized,
          page,
          raster,
          unitFactor,
          ocrLayer,
          'Standard'
        );
        for (const text of texts) addEntity(page, text);
        document.meta.ocrPages.push(page.number);
        if (texts.length === 0) {
          document.meta.degradations.push({
            code: 'ocr_no_text',
            page: page.number,
          });
        }
        await options.onProgress?.('ocr', (i + 1) / candidates.length);
      }
    } finally {
      source.destroy();
    }

    for (const layer of layers.list()) {
      if (layer.name === '0') continue;
      if (!document.layers.some(existing => existing.name === layer.name)) {
        document.layers.push(layer);
      }
    }
    document.meta.degradations.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  }
}

function addEntity(page: CadPage, entity: CadEntity): void {
  page.entities.push(entity);
  countEntity(page.stats, entity);
}
