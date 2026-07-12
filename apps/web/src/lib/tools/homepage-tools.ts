import { recommendedTools, type ToolMeta } from './tool-metadata';

const homepageQuickToolKeys = [
  'imageCompress',
  'imageStitch',
  'pdfFromDocument',
  'imageAnimation',
] as const;

export function createHomepageQuickTools(
  sourceTools: ToolMeta[] = recommendedTools
): ToolMeta[] {
  return homepageQuickToolKeys
    .map(key => sourceTools.find(tool => tool.key === key))
    .filter((tool): tool is ToolMeta => Boolean(tool));
}
