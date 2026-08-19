import path from 'path';
import { fileURLToPath } from 'url';
import createNextIntlPlugin from 'next-intl/plugin';
import withPWA from '@ducanh2912/next-pwa';
import bundleAnalyzer from '@next/bundle-analyzer';
import { staticAssetHeaders } from './src/config/cache-headers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    // @huggingface/transformers 只在浏览器用(useLocalIdPhoto 里的 `await import(...)`,
    // SSR 期间不会执行)。server bundle 里 stub 成空模块:它会把 onnxruntime-node 拖进
    // server 图(含 .node 原生扩展),且这些 dist 是给浏览器打的包,会让 Next 的
    // client-reference 解析崩掉,证件照页与 /_not-found 的 prerender 报
    // "Cannot read properties of undefined (reading 'call')"。
    resolvedConfig.resolve = resolvedConfig.resolve ?? {};
    const ortAlias = options.isServer
      ? {
          '@huggingface/transformers': false,
          'onnxruntime-web': false,
          'onnxruntime-node': false,
        }
      : {};
    const existingAlias = resolvedConfig.resolve.alias;
    if (Array.isArray(existingAlias)) {
      resolvedConfig.resolve.alias = [...existingAlias, ortAlias];
    } else {
      resolvedConfig.resolve.alias = {
        ...(existingAlias ?? {}),
        ...ortAlias,
      };
    }

    // onnxruntime-web 的 dist 是预打包 .mjs（含 import.meta、export{} 与 require 兜底 shim）。
    // Next 的 catch-all SWC loader 会把它们按 script 解析,报
    // "import.meta cannot be used outside of module code"。在 SWC 所在的 oneOf 最前面插一条
    // 规则,first-match-wins 后交给 webpack 原生解析器:`javascript/auto` 依据内容嗅探
    // (发现 export{} 即判为 module),import.meta/export 合法。
    //
    // 核心坑:webpack 的 URLParserPlugin 会把 ort dist 里的
    // `new URL(specifier, import.meta.url)` 改写成
    // `new __webpack_require__.U(__webpack_require__(assetModule))`。而该 .mjs 被本规则按
    // javascript/auto 解析成了库对象(不是 URL 字串),`U(libraryObject)` 进入 RelativeURL
    // 构造函数就报 `url.replace is not a function`。故 `parser.url = false` 关掉改写,
    // 并用自定义 loader 在解析前把 `import.meta.url` 文本替换为运行时表达式
    // (避免 ImportMetaPlugin 把它内联成源文件的 `file://...` URL —— ort 的
    // `isEsmImportMetaUrlHardcodedAsFileUri` guard 命中 file:// 会走坏分支)。
    //
    // ort wasm 的实际加载路径由 model-registry.ortWasmPath()(MinIO)经
    // `env.backends.onnx.wasm.wasmPaths` 接管,不依赖上面这个 URL。
    //
    // 规则只加在 client:server 侧已被 alias 成 false(见上),不进模块图。
    const nativeEsmOrtRule = {
      test: [/[\\/]node_modules[\\/].*[\\/]onnxruntime-web[\\/].*\.m?js$/],
      type: 'javascript/auto',
      resolve: { fullySpecified: false },
      parser: { url: false },
      use: [
        {
          loader: path.resolve(
            __dirname,
            'webpack/loaders/replace-import-meta-url.js'
          ),
        },
      ],
    };
    if (!options.isServer) {
      for (const rule of resolvedConfig.module?.rules ?? []) {
        if (Array.isArray(rule.oneOf) && rule.oneOf.length) {
          rule.oneOf.unshift(nativeEsmOrtRule);
        }
      }
    }

    if (options.isServer) {
      return stripPwaBrowserEntryFromServer(resolvedConfig);
    }

    return resolvedConfig;
  },
};
