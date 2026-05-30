import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = join(process.cwd());
const publicDir = join(appRoot, 'public');

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
      'icons/icon-16.png',
      'icons/icon-32.png',
      'icons/icon-96.png',
      'icons/icon-180.png',
      'icons/icon-192.png',
      'icons/icon-512.png',
      'icons/image-96.png',
      'icons/pdf-96.png',
    ]) {
      expect(statSync(join(publicDir, file)).size, file).toBeGreaterThan(0);
    }
  });

  it('defines a routable app-router offline fallback page', () => {
    expect(
      statSync(join(appRoot, 'src/app/%5Foffline/page.tsx')).isFile()
    ).toBe(true);
  });

  it('configures next-pwa in the web app config', () => {
    const nextConfig = readFileSync(join(appRoot, 'next.config.mjs'), 'utf8');

    expect(nextConfig).toContain("@ducanh2912/next-pwa");
    expect(nextConfig).toContain("dest: 'public'");
    expect(nextConfig).toContain('cacheOnFrontEndNav: true');
    expect(nextConfig).toContain('aggressiveFrontEndNavCaching: true');
    expect(nextConfig).toContain('reloadOnOnline: true');
  });
});
