import type { FileItem } from '@/components/tools/file-list';

export function getImageCompressionIndices(
  items: readonly FileItem[]
): number[] {
  return items.map((_, index) => index);
}
