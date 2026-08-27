import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import {
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_SOURCE_MAX_BYTES,
  canThumbnailFile,
  isThumbnailableMimeType,
  renderThumbnail,
} from './thumbnail.util';

describe('isThumbnailableMimeType', () => {
  it('accepts the image types the browser also renders inline', () => {
    for (const type of [
      'image/png',
      'image/jpeg',
      'IMAGE/WEBP',
      'image/avif',
      'image/gif',
    ]) {
      expect(isThumbnailableMimeType(type), type).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const type of [
      'application/pdf',
      'image/svg+xml',
      'image/tiff',
      'font/ttf',
      '',
    ]) {
      expect(isThumbnailableMimeType(type), type).toBe(false);
    }
  });
});

describe('canThumbnailFile', () => {
  it('refuses originals past the decode budget', () => {
    expect(
      canThumbnailFile({
        mimeType: 'image/png',
        originalSize: THUMBNAIL_SOURCE_MAX_BYTES,
      })
    ).toBe(true);
    expect(
      canThumbnailFile({
        mimeType: 'image/png',
        originalSize: THUMBNAIL_SOURCE_MAX_BYTES + 1,
      })
    ).toBe(false);
  });
});

describe('renderThumbnail', () => {
  it('downscales to webp within the long-edge budget', async () => {
    const source = await sharp({
      create: {
        width: 1024,
        height: 768,
        channels: 3,
        background: { r: 200, g: 30, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const thumbnail = await renderThumbnail(source);
    const meta = await sharp(thumbnail).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(THUMBNAIL_MAX_EDGE);
    expect(meta.height).toBe(240);
    // 缩略图必须比原图小,否则这个接口毫无意义。
    expect(thumbnail.length).toBeLessThan(source.length);
  });

  it('never enlarges a small image', async () => {
    const source = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const meta = await sharp(await renderThumbnail(source)).metadata();
    expect(meta.width).toBe(64);
  });
});
