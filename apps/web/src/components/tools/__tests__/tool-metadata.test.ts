import { describe, expect, it } from 'vitest';
import {
  getToolByHref,
  groupedPdfTools,
  imageToolGroups,
  primaryToolHrefs,
} from '@/lib/tools/tool-metadata';

describe('tool metadata', () => {
  it('keeps dashboard and marketing primary tool links pointed at real app routes', () => {
    expect(primaryToolHrefs).toEqual([
      '/image/compress',
      '/pdf/merge',
      '/font',
    ]);
  });

  it('groups every PDF tool into a user intent category', () => {
    const hrefs = groupedPdfTools.flatMap(group =>
      group.tools.map(tool => tool.href)
    );

    expect(hrefs).toEqual([
      '/pdf/merge',
      '/pdf/split',
      '/pdf/rearrange',
      '/pdf/rotate',
      '/pdf/from-image',
      '/pdf/to-image',
      '/pdf/to-text',
      '/pdf/metadata',
      '/pdf/encrypt',
      '/pdf/watermark',
      '/pdf/compress',
    ]);
  });

  it('marks image compression as local-first and PDF merge as server processing', () => {
    expect(getToolByHref('/image/compress')?.processing).toBe('local-first');
    expect(getToolByHref('/pdf/merge')?.processing).toBe('server');
  });

  it('does not leave the image catalog under-explained', () => {
    expect(imageToolGroups.flatMap(group => group.tools)).toHaveLength(4);
  });
});
