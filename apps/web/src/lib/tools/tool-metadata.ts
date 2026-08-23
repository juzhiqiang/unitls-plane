import type { LucideIcon } from 'lucide-react';
import type { FeatureKey, LimitKey } from '@utils-plane/utils';
import {
  ArrowUpDown,
  BadgeCheck,
  Crop,
  Film,
  FileText,
  Grid3x3,
  ImageDown,
  Images,
  Info,
  Lock,
  Merge,
  Minimize2,
  PanelTop,
  RefreshCw,
  RotateCw,
  Scissors,
  Sparkles,
  Stamp,
  Type,
} from 'lucide-react';

export type ToolProcessing = 'local' | 'local-first' | 'server';
export type ToolRetention = 'browser-session' | 'server-24h' | 'account-files';

export interface ToolMeta {
  key: string;
  href: string;
  icon: LucideIcon;
  titleKey: string;
  descriptionKey: string;
  categoryKey: string;
  processing: ToolProcessing;
  retention: ToolRetention;
  requiresLogin: boolean;
  recommended?: boolean;
  featureKeys?: FeatureKey[];
  limitKeys?: LimitKey[];
  tags: string[];
}

export interface ToolGroup {
  key: string;
  titleKey: string;
  descriptionKey: string;
  tools: ToolMeta[];
}

export const primaryToolHrefs = ['/image/compress', '/pdf/merge', '/font'];

export const imageTools: ToolMeta[] = [
  {
    key: 'imageCompress',
    href: '/image/compress',
    icon: ImageDown,
    titleKey: 'ToolCatalog.tools.imageCompress.title',
    descriptionKey: 'ToolCatalog.tools.imageCompress.description',
    categoryKey: 'ToolCatalog.categories.imageOptimize',
    processing: 'local-first',
    retention: 'browser-session',
    requiresLogin: false,
    recommended: true,
    tags: ['local', 'batch'],
  },
  {
    key: 'imageConvert',
    href: '/image/convert',
    icon: RefreshCw,
    titleKey: 'ToolCatalog.tools.imageConvert.title',
    descriptionKey: 'ToolCatalog.tools.imageConvert.description',
    categoryKey: 'ToolCatalog.categories.imageConvert',
    processing: 'local',
    retention: 'browser-session',
    requiresLogin: false,
    recommended: true,
    tags: ['local', 'format'],
  },
  {
    key: 'imageAnimation',
    href: '/image/animation',
    icon: Film,
    titleKey: 'ToolCatalog.tools.imageAnimation.title',
    descriptionKey: 'ToolCatalog.tools.imageAnimation.description',
    categoryKey: 'ToolCatalog.categories.imageAnimation',
    processing: 'local-first',
    retention: 'browser-session',
    requiresLogin: false,
    recommended: true,
    featureKeys: [
      'image.animation.gif',
      'image.animation.apng',
      'image.animation.advancedCompression',
    ],
    limitKeys: [
      'image.animation.maxInputFiles',
      'image.animation.maxFileSize',
      'image.animation.maxFrames',
      'image.animation.maxOutputWidth',
    ],
    tags: ['gif', 'apng', 'animation', 'compress'],
  },
  {
    key: 'imageStitch',
    href: '/image/stitch',
    icon: PanelTop,
    titleKey: 'ToolCatalog.tools.imageStitch.title',
    descriptionKey: 'ToolCatalog.tools.imageStitch.description',
    categoryKey: 'ToolCatalog.categories.imageCompose',
    processing: 'local',
    retention: 'browser-session',
    requiresLogin: false,
    recommended: true,
    featureKeys: ['image.stitch.basic', 'image.stitch.brandFooter'],
    limitKeys: [
      'image.stitch.maxFiles',
      'image.stitch.maxFileSize',
      'image.stitch.maxCanvasPixels',
    ],
    tags: ['stitch', 'long-image', 'ecommerce'],
  },
  {
    key: 'imageWatermark',
    href: '/image/watermark',
    icon: Stamp,
    titleKey: 'ToolCatalog.tools.imageWatermark.title',
    descriptionKey: 'ToolCatalog.tools.imageWatermark.description',
    categoryKey: 'ToolCatalog.categories.imageProtect',
    processing: 'local-first',
    retention: 'browser-session',
    requiresLogin: false,
    tags: ['watermark', 'ownership'],
  },
  {
    key: 'imageIdPhoto',
    href: '/image/id-photo',
    icon: BadgeCheck,
    titleKey: 'ToolCatalog.tools.imageIdPhoto.title',
    descriptionKey: 'ToolCatalog.tools.imageIdPhoto.description',
    categoryKey: 'ToolCatalog.categories.imageConvert',
    processing: 'local-first',
    retention: 'account-files',
    requiresLogin: false,
    recommended: true,
    tags: ['id-photo', 'background', 'crop'],
  },
  {
    key: 'imageCrop',
    href: '/image/crop',
    icon: Crop,
    titleKey: 'ToolCatalog.tools.imageCrop.title',
    descriptionKey: 'ToolCatalog.tools.imageCrop.description',
    categoryKey: 'ToolCatalog.categories.imageConvert',
    processing: 'local',
    retention: 'browser-session',
    requiresLogin: false,
    tags: ['crop', 'resize', 'aspect'],
  },
  {
    key: 'imageMosaic',
    href: '/image/mosaic',
    icon: Grid3x3,
    titleKey: 'ToolCatalog.tools.imageMosaic.title',
    descriptionKey: 'ToolCatalog.tools.imageMosaic.description',
    categoryKey: 'ToolCatalog.categories.imageProtect',
    processing: 'local',
    retention: 'browser-session',
    requiresLogin: false,
    tags: ['mosaic', 'privacy', 'redact'],
  },
  {
    key: 'imageCutout',
    href: '/image/cutout',
    icon: Scissors,
    titleKey: 'ToolCatalog.tools.imageCutout.title',
    descriptionKey: 'ToolCatalog.tools.imageCutout.description',
    categoryKey: 'ToolCatalog.categories.imageCompose',
    processing: 'local',
    retention: 'browser-session',
    requiresLogin: false,
    recommended: true,
    tags: ['cutout', 'background', 'transparent'],
  },
  {
    key: 'imageBatch',
    href: '/image/compress',
    icon: Images,
    titleKey: 'ToolCatalog.tools.imageBatch.title',
    descriptionKey: 'ToolCatalog.tools.imageBatch.description',
    categoryKey: 'ToolCatalog.categories.imageBatch',
    processing: 'local-first',
    retention: 'browser-session',
    requiresLogin: false,
    tags: ['batch', 'zip'],
  },
  {
    key: 'imageCompare',
    href: '/image/compress',
    icon: ArrowUpDown,
    titleKey: 'ToolCatalog.tools.imageCompare.title',
    descriptionKey: 'ToolCatalog.tools.imageCompare.description',
    categoryKey: 'ToolCatalog.categories.imagePreview',
    processing: 'local',
    retention: 'browser-session',
    requiresLogin: false,
    tags: ['preview', 'quality'],
  },
  {
    key: 'imageGenerate',
    href: '/image/generate',
    icon: Sparkles,
    titleKey: 'ToolCatalog.tools.imageGenerate.title',
    descriptionKey: 'ToolCatalog.tools.imageGenerate.description',
    categoryKey: 'ToolCatalog.categories.imageGenerate',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    limitKeys: ['image.generate.dailyCount'],
    tags: ['ai', 'generate', 'prompt'],
  },
];

export const pdfTools: ToolMeta[] = [
  {
    key: 'pdfMerge',
    href: '/pdf/merge',
    icon: Merge,
    titleKey: 'ToolCatalog.tools.pdfMerge.title',
    descriptionKey: 'ToolCatalog.tools.pdfMerge.description',
    categoryKey: 'ToolCatalog.categories.pdfOrganize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    recommended: true,
    tags: ['combine', 'order'],
  },
  {
    key: 'pdfSplit',
    href: '/pdf/split',
    icon: Scissors,
    titleKey: 'ToolCatalog.tools.pdfSplit.title',
    descriptionKey: 'ToolCatalog.tools.pdfSplit.description',
    categoryKey: 'ToolCatalog.categories.pdfOrganize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    recommended: true,
    tags: ['pages', 'extract'],
  },
  {
    key: 'pdfRearrange',
    href: '/pdf/rearrange',
    icon: ArrowUpDown,
    titleKey: 'ToolCatalog.tools.pdfRearrange.title',
    descriptionKey: 'ToolCatalog.tools.pdfRearrange.description',
    categoryKey: 'ToolCatalog.categories.pdfOrganize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['pages', 'drag'],
  },
  {
    key: 'pdfRotate',
    href: '/pdf/rotate',
    icon: RotateCw,
    titleKey: 'ToolCatalog.tools.pdfRotate.title',
    descriptionKey: 'ToolCatalog.tools.pdfRotate.description',
    categoryKey: 'ToolCatalog.categories.pdfOrganize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['pages', 'rotation'],
  },
  {
    key: 'pdfFromImage',
    href: '/pdf/from-image',
    icon: Images,
    titleKey: 'ToolCatalog.tools.pdfFromImage.title',
    descriptionKey: 'ToolCatalog.tools.pdfFromImage.description',
    categoryKey: 'ToolCatalog.categories.pdfConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['images', 'pdf'],
  },
  {
    key: 'pdfFromDocument',
    href: '/pdf/from-document',
    icon: FileText,
    titleKey: 'ToolCatalog.tools.pdfFromDocument.title',
    descriptionKey: 'ToolCatalog.tools.pdfFromDocument.description',
    categoryKey: 'ToolCatalog.categories.pdfConvert',
    processing: 'local-first',
    retention: 'browser-session',
    requiresLogin: false,
    recommended: true,
    featureKeys: ['pdf.document.localExport', 'pdf.document.serverExport'],
    tags: ['markdown', 'docx', 'editor'],
  },
  {
    key: 'pdfToImage',
    href: '/pdf/to-image',
    icon: Images,
    titleKey: 'ToolCatalog.tools.pdfToImage.title',
    descriptionKey: 'ToolCatalog.tools.pdfToImage.description',
    categoryKey: 'ToolCatalog.categories.pdfConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['png', 'jpeg'],
  },
  {
    key: 'pdfToText',
    href: '/pdf/to-text',
    icon: FileText,
    titleKey: 'ToolCatalog.tools.pdfToText.title',
    descriptionKey: 'ToolCatalog.tools.pdfToText.description',
    categoryKey: 'ToolCatalog.categories.pdfConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['markdown', 'text'],
  },
  {
    key: 'pdfMetadata',
    href: '/pdf/metadata',
    icon: Info,
    titleKey: 'ToolCatalog.tools.pdfMetadata.title',
    descriptionKey: 'ToolCatalog.tools.pdfMetadata.description',
    categoryKey: 'ToolCatalog.categories.pdfConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['metadata', 'author'],
  },
  {
    key: 'pdfEncrypt',
    href: '/pdf/encrypt',
    icon: Lock,
    titleKey: 'ToolCatalog.tools.pdfEncrypt.title',
    descriptionKey: 'ToolCatalog.tools.pdfEncrypt.description',
    categoryKey: 'ToolCatalog.categories.pdfSecurity',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['password', 'permissions'],
  },
  {
    key: 'pdfWatermark',
    href: '/pdf/watermark',
    icon: Stamp,
    titleKey: 'ToolCatalog.tools.pdfWatermark.title',
    descriptionKey: 'ToolCatalog.tools.pdfWatermark.description',
    categoryKey: 'ToolCatalog.categories.pdfSecurity',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['watermark', 'ownership'],
  },
  {
    key: 'pdfCompress',
    href: '/pdf/compress',
    icon: Minimize2,
    titleKey: 'ToolCatalog.tools.pdfCompress.title',
    descriptionKey: 'ToolCatalog.tools.pdfCompress.description',
    categoryKey: 'ToolCatalog.categories.pdfOptimize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    recommended: true,
    tags: ['size', 'quality'],
  },
];

export const fontTools: ToolMeta[] = [
  {
    key: 'fontConvert',
    href: '/font',
    icon: Type,
    titleKey: 'ToolCatalog.tools.fontConvert.title',
    descriptionKey: 'ToolCatalog.tools.fontConvert.description',
    categoryKey: 'ToolCatalog.categories.fontConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    recommended: true,
    tags: ['ttf', 'woff2'],
  },
];

function groupByCategory(tools: ToolMeta[]): ToolGroup[] {
  const orderedKeys = Array.from(new Set(tools.map(tool => tool.categoryKey)));

  return orderedKeys.map(categoryKey => ({
    key: categoryKey.split('.').at(-1) ?? categoryKey,
    titleKey: categoryKey,
    descriptionKey: `${categoryKey}Description`,
    tools: tools.filter(tool => tool.categoryKey === categoryKey),
  }));
}

export const imageToolGroups = groupByCategory(imageTools);
export const groupedPdfTools = groupByCategory(pdfTools);
export const fontToolGroups = groupByCategory(fontTools);
export const allTools = [...imageTools, ...pdfTools, ...fontTools];
export const recommendedTools = allTools.filter(tool => tool.recommended);

export function getToolByHref(href: string): ToolMeta | undefined {
  return allTools.find(tool => tool.href === href);
}
