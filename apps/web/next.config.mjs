import createNextIntlPlugin from 'next-intl/plugin';
import withPWA from '@ducanh2912/next-pwa';
import bundleAnalyzer from '@next/bundle-analyzer';
import { staticAssetHeaders } from './src/config/cache-headers.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@utils-plane/db',
    '@utils-plane/validators',
    '@utils-plane/api-client',
    '@utils-plane/utils',
  ],
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});
const withPwa = withPWA({
  dest: 'public',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable:
    process.env.NODE_ENV === 'development' ||
    process.env.DISABLE_PWA === 'true',
  fallbacks: {
    document: '/_offline',
  },
  workboxOptions: {
    disableDevLogs: true,
  },
});

const analyzedConfig = withBundleAnalyzer(nextConfig);
const pwaConfig = withPwa(withNextIntl(analyzedConfig));

function isPwaBrowserEntry(entry) {
  return (
    typeof entry === 'string' &&
    entry.includes('@ducanh2912') &&
    entry.includes('next-pwa') &&
    entry.includes('sw-entry')
  );
}

function stripPwaBrowserEntryFromServer(config) {
  if (typeof config.entry !== 'function') {
    return config;
  }

  const originalEntry = config.entry;
  config.entry = async () => {
    const entries = await originalEntry();

    for (const key of ['main.js', 'main-app']) {
      const entry = entries[key];

      if (Array.isArray(entry)) {
        entries[key] = entry.filter(item => !isPwaBrowserEntry(item));
      } else if (isPwaBrowserEntry(entry)) {
        delete entries[key];
      }
    }

    return entries;
  };

  return config;
}

export default {
  ...pwaConfig,
  async headers() {
    const inheritedHeaders = await pwaConfig.headers?.();
    return [...(inheritedHeaders ?? []), ...staticAssetHeaders];
  },
  webpack(config, options) {
    const resolvedConfig = pwaConfig.webpack?.(config, options) ?? config;

    if (options.isServer) {
      return stripPwaBrowserEntryFromServer(resolvedConfig);
    }

    return resolvedConfig;
  },
};
