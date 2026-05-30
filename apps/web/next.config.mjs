import createNextIntlPlugin from 'next-intl/plugin';
import withPWA from '@ducanh2912/next-pwa';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@utils-plane/db',
    '@utils-plane/validators',
    '@utils-plane/api-client',
    '@utils-plane/utils',
  ],
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
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

const pwaConfig = withPwa(withNextIntl(nextConfig));

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
        entries[key] = entry.filter((item) => !isPwaBrowserEntry(item));
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
  webpack(config, options) {
    const resolvedConfig = pwaConfig.webpack?.(config, options) ?? config;

    if (options.isServer) {
      return stripPwaBrowserEntryFromServer(resolvedConfig);
    }

    return resolvedConfig;
  },
};
