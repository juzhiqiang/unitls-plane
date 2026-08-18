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

    // @imgly/background-removal 的 CPU 路径会动态 `import("onnxruntime-web")`（裸导入）。
    // onnxruntime-web 的 `.` 导出把 `node` 条件排在 `import` 之前且没有 `browser` 条件,
    // webpack 会命中 `node.import → ort.node.min.mjs`(含 createRequire/process,非浏览器安全),
    // SWC 按脚本解析即报 "import/export cannot be used outside of module code"。
    // 用精确匹配别名($ 后缀)把裸 `onnxruntime-web` 指向 `./wasm` 子路径
    // (ort.wasm.bundle.min.mjs,浏览器安全,带 default 导出),而 `onnxruntime-web/webgpu`
    // 因为多了子路径不命中精确匹配,仍解析为 webgpu bundle,不受影响。
    resolvedConfig.resolve = resolvedConfig.resolve ?? {};
    const ortAlias = { 'onnxruntime-web$': 'onnxruntime-web/wasm' };
    const existingAlias = resolvedConfig.resolve.alias;
    if (Array.isArray(existingAlias)) {
      resolvedConfig.resolve.alias = [...existingAlias, ortAlias];
    } else {
      resolvedConfig.resolve.alias = {
        ...(existingAlias ?? {}),
        ...ortAlias,
      };
    }

    // onnxruntime-web 与 @imgly/background-removal 的 dist 是预打包的 .mjs（含 import.meta、
    // export{} 与 require 兜底 shim）。Next 的 catch-all SWC loader 会把它们按 script 解析,
    // 报 "import.meta cannot be used outside of module code" / "export cannot be used outside
    // of module code"。在 SWC 所在的 oneOf 最前面插一条无 loader 规则:first-match-wins 命中后
    // 交给 webpack 原生解析器:`javascript/auto` 依据内容嗅探(发现 export{} 即判为 module),
    // import.meta/export 合法,且 require shim 不触发 SWC 报错。
    const nativeEsmOrtRule = {
      test: [
        /[\\/]node_modules[\\/].*[\\/]onnxruntime-web[\\/].*\.m?js$/,
        /[\\/]node_modules[\\/].*[\\/]@imgly[\\/]background-removal[\\/].*\.m?js$/,
      ],
      type: 'javascript/auto',
      resolve: { fullySpecified: false },
    };
    for (const rule of resolvedConfig.module?.rules ?? []) {
      if (Array.isArray(rule.oneOf) && rule.oneOf.length) {
        rule.oneOf.unshift(nativeEsmOrtRule);
      }
    }

    if (options.isServer) {
      return stripPwaBrowserEntryFromServer(resolvedConfig);
    }

    return resolvedConfig;
  },
};
