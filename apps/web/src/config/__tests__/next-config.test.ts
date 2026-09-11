import { describe, expect, it } from 'vitest';

const configModule = await import('../../../next.config.mjs');

describe('Next.js build and PWA configuration', () => {
  it('uses the regular output on Windows and standalone output elsewhere', () => {
    expect(configModule.getNextOutput('win32')).toBeUndefined();
    expect(configModule.getNextOutput('linux')).toBe('standalone');
    expect(configModule.default.output).toBe(
      configModule.getNextOutput(process.platform)
    );
  });

  it('excludes only oversized generic static JavaScript chunks', () => {
    const exclude = configModule.excludeLargeStaticJsChunk;
    const oversized = 2 * 1024 * 1024 + 1;

    expect(
      exclude({ asset: { name: 'static/chunks/vendor.js', size: oversized } })
    ).toBe(true);
    expect(
      exclude({
        asset: {
          name: 'static/chunks/vendor-from-webpack.js',
          source: { size: () => oversized },
        },
      })
    ).toBe(true);
    expect(
      exclude({
        asset: { name: 'static/chunks/vendor.js', size: 2 * 1024 * 1024 },
      })
    ).toBe(false);
    expect(
      exclude({ asset: { name: 'static/css/app.js', size: oversized } })
    ).toBe(false);
    expect(
      exclude({
        asset: {
          name: 'static/chunks/app/[locale]/(app)/image/page-large.js',
          size: oversized,
        },
      })
    ).toBe(false);
    expect(
      exclude({
        asset: { name: 'static/chunks/image-worker.js', size: oversized },
      })
    ).toBe(false);
  });

  it('caches Next static chunks with a bounded seven-day CacheFirst rule', () => {
    const rule = configModule.staticChunkRuntimeCaching;

    expect(rule.handler).toBe('CacheFirst');
    expect(rule.urlPattern).toEqual(/\/_next\/static\/chunks\/.+\.js$/i);
    expect(rule.options).toMatchObject({
      cacheName: 'next-static-js-assets',
      expiration: {
        maxAgeSeconds: 7 * 24 * 60 * 60,
        maxEntries: 20,
      },
    });
  });

  it('keeps the global precache size limit unchanged', () => {
    expect(configModule.pwaWorkboxOptions).not.toHaveProperty(
      'maximumFileSizeToCacheInBytes'
    );
  });
});
