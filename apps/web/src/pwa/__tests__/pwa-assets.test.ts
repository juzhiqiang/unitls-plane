import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const appRoot = join(process.cwd());
const publicDir = join(appRoot, 'public');

function decodeRgbaPng(file: string) {
  const png = readFileSync(file);
  const signature = png.subarray(0, 8).toString('hex');
  expect(signature, file).toBe('89504e470d0a1a0a');

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === 'IHDR') {
      width = png.readUInt32BE(dataStart);
      height = png.readUInt32BE(dataStart + 4);
      bitDepth = png[dataStart + 8];
      colorType = png[dataStart + 9];
    }

    if (type === 'IDAT') {
      idatChunks.push(png.subarray(dataStart, dataEnd));
    }

    offset = dataEnd + 4;

    if (type === 'IEND') {
      break;
    }
  }

  expect(bitDepth, file).toBe(8);
  expect(colorType, file).toBe(6);

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  let nonTransparentPixels = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.from(
      inflated.subarray(sourceOffset, sourceOffset + stride)
    );
    sourceOffset += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;

      let predictor = 0;
      if (filter === 1) {
        predictor = left;
      } else if (filter === 2) {
        predictor = up;
      } else if (filter === 3) {
        predictor = Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }

      row[x] = (row[x] + predictor) & 0xff;
    }

    for (let x = 3; x < stride; x += bytesPerPixel) {
      if (row[x] > 0) {
        nonTransparentPixels += 1;
      }
    }

    previous = row;
  }

  return {
    width,
    height,
    nonTransparentRatio: nonTransparentPixels / (width * height),
  };
}

describe('PWA assets', () => {
  it('defines an installable manifest with required colors and shortcuts', () => {
    const manifest = JSON.parse(
      readFileSync(join(publicDir, 'manifest.json'), 'utf8')
    ) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      background_color: string;
      theme_color: string;
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
      shortcuts: Array<{ name: string; url: string }>;
    };

    expect(manifest.name).toBe('Utils-Plane');
    expect(manifest.short_name).toBe('UtilsPlane');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#0a0a0c');
    expect(manifest.theme_color).toBe('#0a0a0c');
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: '/icons/icon-192.png',
          sizes: '192x192',
          purpose: 'any',
        }),
        expect.objectContaining({
          src: '/icons/icon-512.png',
          sizes: '512x512',
          purpose: 'any maskable',
        }),
      ])
    );
    expect(manifest.shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Image', url: '/image/compress' }),
        expect.objectContaining({ name: 'PDF', url: '/pdf/merge' }),
      ])
    );
  });

  it('includes icon files referenced by the manifest and platform metadata', () => {
    for (const file of [
      'favicon.ico',
      'icons/icon-16.png',
      'icons/icon-32.png',
      'icons/icon-96.png',
      'icons/icon-180.png',
      'icons/icon-192.png',
      'icons/icon-512.png',
      'icons/utils-plane-favicon-32.png',
      'icons/utils-plane-apple-touch-180.png',
      'icons/image-96.png',
      'icons/pdf-96.png',
    ]) {
      expect(statSync(join(publicDir, file)).size, file).toBeGreaterThan(0);
    }
  });

  it('uses correctly rendered non-empty app icons', () => {
    for (const [file, size] of [
      ['icons/icon-16.png', 16],
      ['icons/icon-32.png', 32],
      ['icons/icon-96.png', 96],
      ['icons/icon-180.png', 180],
      ['icons/icon-192.png', 192],
      ['icons/icon-512.png', 512],
      ['icons/utils-plane-favicon-32.png', 32],
      ['icons/utils-plane-apple-touch-180.png', 180],
    ] as const) {
      const icon = decodeRgbaPng(join(publicDir, file));

      expect(icon.width, `${file} width`).toBe(size);
      expect(icon.height, `${file} height`).toBe(size);
      expect(icon.nonTransparentRatio, `${file} content`).toBeGreaterThan(0.5);
    }
  });

  it('defines a routable app-router offline fallback page', () => {
    expect(
      statSync(join(appRoot, 'src/app/%5Foffline/page.tsx')).isFile()
    ).toBe(true);
  });

  it('configures next-pwa in the web app config', () => {
    const nextConfig = readFileSync(join(appRoot, 'next.config.mjs'), 'utf8');

    expect(nextConfig).toContain('@ducanh2912/next-pwa');
    expect(nextConfig).toContain("dest: 'public'");
    expect(nextConfig).toContain('cacheOnFrontEndNav: true');
    expect(nextConfig).toContain('aggressiveFrontEndNavCaching: true');
    expect(nextConfig).toContain('reloadOnOnline: true');
  });
});
