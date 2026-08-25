import { describe, it, expect } from 'vitest';
import {
  PREVIEW_MAX_BYTES,
  THUMBNAIL_MAX_BYTES,
  canPreviewFile,
  getFilePreviewKind,
  isPreviewableType,
  shouldRenderThumbnail,
} from '../preview';

describe('getFilePreviewKind', () => {
  it('detects images the browser can render', () => {
    for (const type of [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'image/avif',
      'image/svg+xml',
      'IMAGE/PNG',
    ]) {
      expect(getFilePreviewKind(type), type).toBe('image');
    }
  });

  it('detects pdf', () => {
    expect(getFilePreviewKind('application/pdf')).toBe('pdf');
  });

  it('rejects image formats browsers cannot decode', () => {
    for (const type of ['image/heic', 'image/heif', 'image/tiff']) {
      expect(getFilePreviewKind(type), type).toBe('none');
    }
  });

  it('rejects fonts and unknown types', () => {
    for (const type of ['font/ttf', 'font/woff2', 'text/plain', '']) {
      expect(getFilePreviewKind(type), type).toBe('none');
    }
  });
});

describe('isPreviewableType', () => {
  it('mirrors the preview kind', () => {
    expect(isPreviewableType('image/png')).toBe(true);
    expect(isPreviewableType('font/ttf')).toBe(false);
  });
});

describe('canPreviewFile', () => {
  it('allows previewable types within the size cap', () => {
    expect(
      canPreviewFile({ mimeType: 'application/pdf', originalSize: 1024 })
    ).toBe(true);
    expect(
      canPreviewFile({ mimeType: 'image/png', originalSize: PREVIEW_MAX_BYTES })
    ).toBe(true);
  });

  it('refuses oversized files and unsupported types', () => {
    expect(
      canPreviewFile({
        mimeType: 'image/png',
        originalSize: PREVIEW_MAX_BYTES + 1,
      })
    ).toBe(false);
    expect(canPreviewFile({ mimeType: 'font/ttf', originalSize: 1024 })).toBe(
      false
    );
  });
});

describe('shouldRenderThumbnail', () => {
  it('only renders small images', () => {
    expect(
      shouldRenderThumbnail({
        mimeType: 'image/png',
        originalSize: THUMBNAIL_MAX_BYTES,
      })
    ).toBe(true);
    expect(
      shouldRenderThumbnail({
        mimeType: 'image/png',
        originalSize: THUMBNAIL_MAX_BYTES + 1,
      })
    ).toBe(false);
    expect(
      shouldRenderThumbnail({ mimeType: 'application/pdf', originalSize: 10 })
    ).toBe(false);
  });
});
