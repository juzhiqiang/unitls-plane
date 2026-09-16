import { z } from 'zod';

/**
 * PDF 转 CAD(任务类型 `pdf_to_cad`)的公共契约。
 *
 * 这里是跨模块的单一来源:任务配置 schema、默认值、错误码、降级原因、
 * 单位换算和 outputMeta 形状都由本文件定义。API 的解析器/写出器、任务处理器
 * 与 Web 工具页都只从这里导入,不得各自另起名字或改变语义。
 */

/** 输出格式。DWG 首版只保留 writer 适配边界,任务会以 `CAD_DWG_UNSUPPORTED` 失败。 */
export const CAD_OUTPUT_FORMATS = ['dxf', 'dwg'] as const;
/** 目标图纸单位。 */
export const CAD_UNITS = ['mm', 'inch'] as const;
/**
 * 图层策略。
 * - `source`:按来源对象(描边/填充/文字/图片/页面)、颜色和字体生成稳定图层。
 * - `semantic`:只做确定性的语义规则映射(轮廓、细线、隐藏线、填充、文字等)。
 */
export const CAD_LAYER_MODES = ['source', 'semantic'] as const;
/** 任务失败时写入 `tasks.error_code` 的固定错误码。 */
export const CAD_ERROR_CODES = [
  'CAD_INVALID_CONFIG',
  'CAD_OCR_UNAVAILABLE',
  'CAD_DWG_UNSUPPORTED',
  'CAD_CONVERSION_FAILED',
] as const;
/**
 * 实体来源。
 * - `pdf`:直接由 PDF 原生对象(路径、文字、图片、页面边界)转换而来。
 * - `ocr`:扫描页经 Tesseract 识别出的文字。
 * - `inferred`:启发式推断得到的实体(栅格线段识别、细长填充矩形当作线段等)。
 */
export const CAD_ENTITY_SOURCES = ['pdf', 'ocr', 'inferred'] as const;
/** 中间模型支持的实体类型。 */
export const CAD_ENTITY_TYPES = [
  'line',
  'polyline',
  'arc',
  'circle',
  'hatch',
  'text',
  'mtext',
  'insert',
  'image-underlay',
] as const;
/**
 * 降级原因。转换器在无法无损表达某类 PDF 内容时记录这些原因,前端按 code 展示说明。
 */
export const CAD_DEGRADATION_CODES = [
  'empty_page',
  'raster_page',
  'shading_dropped',
  'clip_ignored',
  'mask_ignored',
  'curve_flattened',
  'thin_fill_as_line',
  'ocr_skipped_native_text',
  'ocr_no_text',
  'raster_lines_inferred',
] as const;

export const PDF_TO_CAD_MAX_PAGES = 500;
export const PDF_TO_CAD_MAX_FILE_SIZE = 50 * 1024 * 1024;
export const PDF_TO_CAD_SCALE_MIN = 0.001;
export const PDF_TO_CAD_SCALE_MAX = 1000;
/** 单个任务允许产出的实体总数上限,超出即 `CAD_CONVERSION_FAILED`。 */
export const PDF_TO_CAD_MAX_ENTITIES = 200_000;

export const cadOutputFormatEnum = z.enum(CAD_OUTPUT_FORMATS);
export const cadUnitEnum = z.enum(CAD_UNITS);
export const cadLayerModeEnum = z.enum(CAD_LAYER_MODES);
export const cadErrorCodeEnum = z.enum(CAD_ERROR_CODES);
export const cadEntitySourceEnum = z.enum(CAD_ENTITY_SOURCES);
export const cadEntityTypeEnum = z.enum(CAD_ENTITY_TYPES);
export const cadDegradationCodeEnum = z.enum(CAD_DEGRADATION_CODES);

/**
 * `pdf_to_cad` 的 `inputConfig`。
 *
 * `pages` 是 0 基页码(与 `pdf_to_image` 一致),解析后去重升序;省略表示全部页面。
 * 坐标约定:输入 PDF 为左上原点、单位 point;中间模型与 DXF 为左下原点;
 * 所有坐标先按 point 换算到目标单位,再乘 `scale`;页面旋转在实体转换前统一处理。
 */
export const pdfToCadTaskConfigSchema = z.object({
  format: cadOutputFormatEnum.default('dxf'),
  pages: z
    .array(z.number().int().min(0))
    .min(1)
    .max(PDF_TO_CAD_MAX_PAGES)
    .transform(pages => [...new Set(pages)].sort((a, b) => a - b))
    .optional(),
  unit: cadUnitEnum.default('mm'),
  scale: z
    .number()
    .finite()
    .min(PDF_TO_CAD_SCALE_MIN)
    .max(PDF_TO_CAD_SCALE_MAX)
    .default(1),
  ocr: z.boolean().default(false),
  includeRasterUnderlay: z.boolean().default(false),
  layerMode: cadLayerModeEnum.default('source'),
});

export type CadOutputFormat = z.infer<typeof cadOutputFormatEnum>;
export type CadUnit = z.infer<typeof cadUnitEnum>;
export type CadLayerMode = z.infer<typeof cadLayerModeEnum>;
export type CadErrorCode = z.infer<typeof cadErrorCodeEnum>;
export type CadEntitySource = z.infer<typeof cadEntitySourceEnum>;
export type CadEntityType = z.infer<typeof cadEntityTypeEnum>;
export type CadDegradationCode = z.infer<typeof cadDegradationCodeEnum>;
export type PdfToCadTaskConfig = z.infer<typeof pdfToCadTaskConfigSchema>;
export type PdfToCadTaskConfigInput = z.input<typeof pdfToCadTaskConfigSchema>;

export const DEFAULT_PDF_TO_CAD_CONFIG: PdfToCadTaskConfig =
  pdfToCadTaskConfigSchema.parse({});

/** 1 PDF point = 1/72 inch。 */
export const CAD_POINT_TO_UNIT: Record<CadUnit, number> = {
  mm: 25.4 / 72,
  inch: 1 / 72,
};

/** point → 目标单位 × 比例。解析器与前端预估尺寸都用这一个函数,避免两边漂移。 */
export function pointToCadUnit(
  points: number,
  unit: CadUnit,
  scale = 1
): number {
  return points * CAD_POINT_TO_UNIT[unit] * scale;
}

export const cadDegradationSchema = z.object({
  code: cadDegradationCodeEnum,
  /** 1 基页码;省略表示整份文档。 */
  page: z.number().int().positive().optional(),
  /** 该原因在页内发生的次数(如丢弃的渐变个数);省略表示一次或不适用。 */
  count: z.number().int().positive().optional(),
  detail: z.string().max(200).optional(),
});

/**
 * 转换元数据,任务完成后原样写入 `tasks.output_meta`,前端用它展示统计与降级说明。
 */
export const pdfToCadConversionMetaSchema = z.object({
  converterVersion: z.string(),
  format: cadOutputFormatEnum,
  unit: cadUnitEnum,
  scale: z.number(),
  layerMode: cadLayerModeEnum,
  /** 源 PDF 总页数。 */
  sourcePageCount: z.number().int().nonnegative(),
  /** 实际转换页数。 */
  pageCount: z.number().int().nonnegative(),
  /** 实际转换的 1 基页码。 */
  pages: z.array(z.number().int().positive()),
  entityCount: z.number().int().nonnegative(),
  entityCountBySource: z.object({
    pdf: z.number().int().nonnegative(),
    ocr: z.number().int().nonnegative(),
    inferred: z.number().int().nonnegative(),
  }),
  entityCountByType: z.record(
    cadEntityTypeEnum,
    z.number().int().nonnegative()
  ),
  /** OCR 识别出的文字实体数。 */
  ocrTextCount: z.number().int().nonnegative(),
  /** 实际执行了 OCR 的 1 基页码。 */
  ocrPages: z.array(z.number().int().positive()),
  /** 输出是否包含栅格底图资源(为 true 时产物是 ZIP)。 */
  underlay: z.boolean(),
  degradations: z.array(cadDegradationSchema),
});

export type CadDegradation = z.infer<typeof cadDegradationSchema>;
export type PdfToCadConversionMeta = z.infer<
  typeof pdfToCadConversionMetaSchema
>;
