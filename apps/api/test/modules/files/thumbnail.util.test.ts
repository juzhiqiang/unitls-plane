import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import {
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_SOURCE_MAX_BYTES,
  canThumbnailFile,
  isThumbnailableMimeType,
  renderThumbnail,
  THUMBNAIL_VERSION,
  getThumbnailObjectKey,
  getThumbnailETag,
  matchesIfNoneMatch,
} from '../../../src/modules/files/thumbnail.util';

describe('stream thumbnails', () => {
  it('renders a streamed image and releases the source', async () => {
    const png = await sharp({
      create: { width: 500, height: 200, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    const source = Readable.from([png.subarray(0, 50), png.subarray(50)]);
    const result = await renderThumbnail(source);
    expect((await sharp(result).metadata()).width).toBe(320);
    expect(source.destroyed).toBe(true);
  });
  it('rejects source errors and byte budget overruns', async () => {
    const source = Readable.from(
      (async function* () {
        yield Buffer.alloc(0);
        throw new Error('source failed');
      })()
    );
    await expect(renderThumbnail(source)).rejects.toThrow('source failed');
    const oversized = Readable.from([
      Buffer.alloc(THUMBNAIL_SOURCE_MAX_BYTES + 1),
    ]);
    await expect(renderThumbnail(oversized)).rejects.toThrow(
      'Thumbnail source is too large'
    );
    expect(oversized.destroyed).toBe(true);
  });
});

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

describe('thumbnail cache contract', () => {
  it('builds a versioned object key for the fixed thumbnail size', () => {
    expect(THUMBNAIL_VERSION).toBe(1);
    expect(getThumbnailObjectKey('file-1')).toBe(
      `thumbnails/file-1/${THUMBNAIL_VERSION}-320.webp`
    );
  });

  it('builds the frozen strong ETag with the version', () => {
    expect(getThumbnailETag('file-1')).toBe(
      `"thumb-file-1-320-${THUMBNAIL_VERSION}"`
    );
  });
});

describe('matchesIfNoneMatch', () => {
  const etag = '"thumb-file-1-320-1"';

  it('matches a single strong ETag and tolerates surrounding whitespace', () => {
    expect(matchesIfNoneMatch(` ${etag} `, etag)).toBe(true);
  });

  it('matches one value from a comma-separated list', () => {
    expect(
      matchesIfNoneMatch('"other", W/"weak-other", "thumb-file-1-320-1"', etag)
    ).toBe(true);
  });

  it('matches a wildcard', () => {
    expect(matchesIfNoneMatch('*', etag)).toBe(true);
  });

  it('uses weak comparison for weak and strong tags', () => {
    expect(matchesIfNoneMatch(`W/${etag}`, etag)).toBe(true);
    expect(matchesIfNoneMatch(etag, `W/${etag}`)).toBe(true);
  });

  it('does not match missing, empty, or different tags', () => {
    expect(matchesIfNoneMatch(undefined, etag)).toBe(false);
    expect(matchesIfNoneMatch('', etag)).toBe(false);
    expect(matchesIfNoneMatch('"thumb-file-1-320-2"', etag)).toBe(false);
  });
});
