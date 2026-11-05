import { describe, expect, it } from 'vitest';
import { buildSplitInputConfig } from '../../../../../../src/app/[locale]/(app)/pdf/split/input-config';

describe('buildSplitInputConfig', () => {
  it('converts displayed range numbers to zero-based service tuples', () => {
    expect(
      buildSplitInputConfig('ranges', { rangeStart: 2, rangeEnd: 5 })
    ).toEqual({
      mode: 'ranges',
      ranges: [[1, 4]],
    });
  });

  it('converts displayed page numbers to zero-based service indexes', () => {
    expect(
      buildSplitInputConfig('pages', { selectedPages: new Set([3, 1]) })
    ).toEqual({
      mode: 'pages',
      pages: [0, 2],
    });
  });

  it('uses the service field name for every N pages', () => {
    expect(buildSplitInputConfig('every', { everyN: 5 })).toEqual({
      mode: 'every',
      every: 5,
    });
  });
});
