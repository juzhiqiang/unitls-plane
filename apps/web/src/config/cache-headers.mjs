const immutableCacheHeader = {
  key: 'Cache-Control',
  value: 'public, max-age=31536000, immutable',
};

export const staticAssetHeaders = [
  {
    source: '/icons/:path*',
    headers: [immutableCacheHeader],
  },
  {
    source: '/pdf.worker.min.mjs',
    headers: [immutableCacheHeader],
  },
];
