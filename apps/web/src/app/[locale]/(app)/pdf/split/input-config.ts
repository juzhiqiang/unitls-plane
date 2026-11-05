export type SplitMode = 'ranges' | 'pages' | 'every';

export type SplitInputConfig =
  | { mode: 'ranges'; ranges: [number, number][] }
  | { mode: 'pages'; pages: number[] }
  | { mode: 'every'; every: number };

interface SplitPageState {
  rangeStart: number;
  rangeEnd: number;
  selectedPages: Set<number>;
  everyN: number;
}

export function buildSplitInputConfig(
  mode: SplitMode,
  { rangeStart, rangeEnd, selectedPages, everyN }: SplitPageState
): SplitInputConfig {
  switch (mode) {
    case 'ranges':
      return {
        mode,
        ranges: [[rangeStart - 1, rangeEnd - 1]],
      };
    case 'pages':
      return {
        mode,
        pages: Array.from(selectedPages)
          .sort((a, b) => a - b)
          .map(page => page - 1),
      };
    case 'every':
      return { mode, every: everyN };
  }
}
