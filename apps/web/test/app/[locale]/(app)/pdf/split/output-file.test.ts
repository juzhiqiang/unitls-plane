import { describe, expect, it } from 'vitest';
import {
  buildSplitOutputFilename,
  estimateSplitOutputKind,
} from '../../../../../../src/app/[locale]/(app)/pdf/split/output-file';

describe('estimateSplitOutputKind', () => {
  it('uses PDF for one range even when that range contains many pages', () => {
    expect(estimateSplitOutputKind('ranges', { pageCount: 8 })).toBe('pdf');
  });

  it('uses PDF for one selected page and ZIP for multiple selected pages', () => {
    expect(
      estimateSplitOutputKind('pages', {
        pageCount: 3,
        selectedPages: new Set([2]),
      })
    ).toBe('pdf');
    expect(
      estimateSplitOutputKind('pages', {
        pageCount: 3,
        selectedPages: new Set([1, 3]),
      })
    ).toBe('zip');
  });

  it('uses PDF only when every N covers the whole document', () => {
    expect(estimateSplitOutputKind('every', { pageCount: 5, everyN: 5 })).toBe(
      'pdf'
    );
    expect(estimateSplitOutputKind('every', { pageCount: 5, everyN: 2 })).toBe(
      'zip'
    );
  });
});

describe('buildSplitOutputFilename', () => {
  it('names fallback titles by the estimated output kind', () => {
    expect(buildSplitOutputFilename('plan.pdf', 'pdf')).toBe('split-plan.pdf');
    expect(buildSplitOutputFilename('/uploads/plan.pdf', 'zip')).toBe(
      'split-plan.zip'
    );
  });
});
