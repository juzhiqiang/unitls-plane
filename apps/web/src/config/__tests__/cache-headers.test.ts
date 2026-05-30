import { describe, expect, it } from 'vitest';
import { staticAssetHeaders } from '../cache-headers.mjs';

describe('staticAssetHeaders', () => {
  it('sets immutable cache headers for long-lived public assets', () => {
    expect(staticAssetHeaders).toEqual([
      {
        source: '/icons/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/pdf.worker.min.mjs',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]);
  });
});
