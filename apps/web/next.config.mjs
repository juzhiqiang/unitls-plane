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

    // ort / @imgly 只在浏览器用(useLocalIdPhoto 里的 `await import(...)`,SSR 期间不会执行)。
    // server bundle 里把它们 stub 成空模块:这些 dist 是给浏览器打的包,进 server 图会让
    // Next 的 client-reference 解析崩掉,证件照页与 /_not-found 的 prerender 会报
    // "Cannot read properties of undefined (reading 'call')"。
    //
    // client 侧则需要另一个别名:@imgly 的 CPU 路径会动态 `import("onnxruntime-web")`(裸导入),
    // 而 ort 的 `.` 导出把 `node` 条件排在 `import` 之前且没有 `browser` 条件,
    // webpack 会命中 `node.import → ort.node.min.mjs`(含 createRequire/process,非浏览器安全)。
    // 用精确匹配别名($ 后缀)把裸 `onnxruntime-web` 指向 `./wasm`
    // (ort.wasm.bundle.min.mjs,浏览器安全,带 default 导出);`onnxruntime-web/webgpu`
    // 因为多了子路径不命中精确匹配,仍解析为 webgpu bundle,不受影响。
    resolvedConfig.resolve = resolvedConfig.resolve ?? {};
    const ortAlias = options.isServer
      ? {
          'onnxruntime-web': false,
          '@imgly/background-removal': false,
        }
      : { 'onnxruntime-web$': 'onnxruntime-web/wasm' };
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
    //
    // 核心坑:webpack 的 URLParserPlugin 会把 ort dist 里的
    // `new URL(specifier, import.meta.url)` 改写成
    // `new __webpack_require__.U(__webpack_require__(assetModule))`。而这些 .mjs 被本规则按
    // javascript/auto 解析成了库对象(不是 URL 字串),`U(libraryObject)` 进入 RelativeURL
    // 构造函数就报 `url.replace is not a function`,本地抠图必崩(已实测:移除本 loader 后,
    // ort 1.21.0 的 ort.webgpu.bundle.min.mjs 立刻在 new RelativeURL 处抛该错)。
    //
    // 修法:用自定义 loader 在 webpack 解析前把这些 .mjs 里的 `import.meta.url` 文本替换为
    // `(document.currentScript&&document.currentScript.src)||self.location.href`。替换后
    // URLParserPlugin 匹配不到 `new URL(x, import.meta.url)` 两参形式,不再改写;
    // ImportMetaPlugin 也不会把 import.meta.url 内联成源文件的 `file://...` URL
    // (高版本 ort 有 `isEsmImportMetaUrlHardcodedAsFileUri` guard 会被 file:// 命中并走坏分支,
    // 1.21.0 无此 guard,但保持替换对两者都安全)。运行时拿到当前 chunk 的 http:// URL;
    // wasm 实际路径由 @imgly 设的 `ort.env.wasm.wasmPaths`(MinIO publicPath)接管,不依赖它。
    //
    // 另见 apps/web/package.json:onnxruntime-web 必须锁 1.21.0。@imgly 1.7.0 硬编码走
    // jsep 版 wasm 且 peerDep 为 1.21.0;ort 1.27.0 把 WebGPU 从 jsep 挪到 asyncify/jspi,
    // jsep glue 只剩 jsepInit 而 webgpu bundle 改调 webgpuInit,导致
    // `webgpuInit is not a function`。
    //
    // 规则只需加在 client:server 侧这两个包已被 alias 成 false(见上),不进模块图。
    const nativeEsmOrtRule = {
      test: [
        /[\\/]node_modules[\\/].*[\\/]onnxruntime-web[\\/].*\.m?js$/,
        /[\\/]node_modules[\\/].*[\\/]@imgly[\\/]background-removal[\\/].*\.m?js$/,
      ],
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
