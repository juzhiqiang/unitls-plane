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
      '/pdf/from-document',
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
    expect(getToolByHref('/image/watermark')?.processing).toBe('local-first');
    expect(getToolByHref('/pdf/merge')?.processing).toBe('server');
  });

  it('does not leave the image catalog under-explained', () => {
    expect(imageToolGroups.flatMap(group => group.tools)).toHaveLength(8);
  });

  it('registers the id photo generator as a server image tool', () => {
    const tool = getToolByHref('/image/id-photo');

    expect(tool?.key).toBe('imageIdPhoto');
    expect(tool?.processing).toBe('server');
    expect(tool?.retention).toBe('account-files');
  });

  it('registers long image stitching as a free local image composition tool', () => {
    const tool = getToolByHref('/image/stitch');

    expect(tool?.key).toBe('imageStitch');
    expect(tool?.processing).toBe('local');
    expect(tool?.retention).toBe('browser-session');
    expect(tool?.requiresLogin).toBe(false);
  });

  it('registers animated images as a free local-first commercial-ready tool', () => {
    const tool = getToolByHref('/image/animation');

    expect(tool?.key).toBe('imageAnimation');
    expect(tool?.processing).toBe('local-first');
    expect(tool?.retention).toBe('browser-session');
    expect(tool?.requiresLogin).toBe(false);
    expect(tool?.tags).toEqual(
      expect.arrayContaining(['gif', 'apng', 'animation', 'compress'])
    );
  });

  it('registers document to PDF as local-first with optional server export', () => {
    const tool = getToolByHref('/pdf/from-document');

    expect(tool?.key).toBe('pdfFromDocument');
    expect(tool?.processing).toBe('local-first');
    expect(tool?.retention).toBe('browser-session');
    expect(tool?.requiresLogin).toBe(false);
    expect(tool?.tags).toEqual(
      expect.arrayContaining(['markdown', 'docx', 'editor'])
    );
  });

  it('assigns entitlement feature keys to commercial-ready tools', () => {
    expect(getToolByHref('/image/animation')?.featureKeys).toEqual(
      expect.arrayContaining([
        'image.animation.gif',
        'image.animation.apng',
        'image.animation.advancedCompression',
      ])
    );
    expect(getToolByHref('/image/stitch')?.featureKeys).toEqual(
      expect.arrayContaining(['image.stitch.basic', 'image.stitch.brandFooter'])
    );
    expect(getToolByHref('/pdf/from-document')?.featureKeys).toEqual(
      expect.arrayContaining([
        'pdf.document.localExport',
        'pdf.document.serverExport',
      ])
    );
  });
});
