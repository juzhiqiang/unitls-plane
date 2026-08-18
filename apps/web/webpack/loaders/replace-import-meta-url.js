/**
 * 替换预打包 .mjs 中的 `import.meta.url` 为运行时安全的表达式。
 *
 * 背景:onnxruntime-web 与 @imgly/background-removal 的 dist 是预打包 ESM,内部用
 * `import.meta.url` 定位自身资源(wasm/worker)。这些文件在 next.config.mjs 里被按
 * `javascript/auto` 交给 webpack 原生解析器,于是:
 *
 * 1. URLParserPlugin 把 `new URL(specifier, import.meta.url)` 改写成
 *    `new __webpack_require__.U(__webpack_require__(assetModule))`;该 .mjs 解析结果是
 *    库对象而非 URL 字串,`U(libraryObject)` → `url.replace is not a function`(实测必崩)。
 * 2. ImportMetaPlugin 会把 `import.meta.url` 内联成源文件的 `file://...` URL;高版本 ort 的
 *    `isEsmImportMetaUrlHardcodedAsFileUri` guard 命中后会走出错分支。
 *
 * 替换成 `(document.currentScript&&document.currentScript.src)||self.location.href` 后,
 * 两个 plugin 都匹配不到 import.meta.url,运行时得到当前 chunk 的 http:// URL。
 * wasm 实际路径由 @imgly 设的 `ort.env.wasm.wasmPaths`(MinIO publicPath)接管,不依赖此值。
 */
module.exports = function replaceImportMetaUrl(source) {
  return source.replace(
    /import\.meta\.url/g,
    '(document.currentScript&&document.currentScript.src)||self.location.href'
  );
};
