export type SplitMode = 'ranges' | 'pages' | 'every';
export type SplitOutputKind = 'pdf' | 'zip';

interface SplitOutputEstimate {
  pageCount: number;
  selectedPages: ReadonlySet<number>;
  everyN: number;
}

export function estimateSplitOutputKind(
  mode: SplitMode,
  { pageCount, selectedPages, everyN }: SplitOutputEstimate
): SplitOutputKind {
  const outputCount =
    mode === 'ranges'
      ? 1
      : mode === 'pages'
        ? selectedPages.size
        : Math.ceil(pageCount / Math.max(1, everyN));

  return outputCount > 1 ? 'zip' : 'pdf';
}

export function buildSplitOutputFilename(
  sourceFilename: string,
  kind: SplitOutputKind
): string {
  const filename = sourceFilename.split(/[\\/]/).pop() ?? 'pdf';
  const base = filename.replace(/\.pdf$/i, '') || 'pdf';

  return `split-${base}.${kind}`;
}
