# A：Web 首屏与 PWA 优化

> 返回
> [三人并行总控](./README.md)。本批只改前端构建配置与前端组件，不触碰 API、Docker 和数据库。分支：`codex/perf-web-pwa`，预估 1.5–2 天。

## 一、目标与边界

| 目标                    | 当前事实                                                    | 本批结果                                               |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| 移除 ONNX 的 PWA 预缓存 | `sw.js` 225 项，约 70.8 MB；`/onnx/**` 共 6 项、约 61.68 MB | 预缓存中 `/onnx/**` 为 0 项                            |
| 降低重点路由首包        | 最重路由 First Load JS 为 247–279 kB                        | 导入重库的路由下降 15% 以上，共享 First Load JS 不增长 |
| 降低 Hero 空闲开销      | 滚出视口后 RAF 仍运行                                       | 离屏时停止 RAF，回到视口后只恢复一个循环               |

**不在本批范围**

- 不修改 Service Worker 运行时缓存策略、CSP 和 HTTP 缓存头。
- 不删除或提交 `apps/web/public/onnx/`。该目录是本机构建资产，已在 `.gitignore` 中。
- 不改页面业务逻辑、接口协议和用户可见文案。
- 不重构 `heic-to`，它已经是懒加载且不在 PWA 预缓存中。

## 二、代码入口与基线

| 文件                                                       | 现状                                                                    | 本批动作                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| `apps/web/next.config.mjs`                                 | `pwaWorkboxOptions.exclude` 只排除超大静态 chunk                        | 增加 `/onnx/**` 排除规则                   |
| `apps/web/test/pwa/pwa-assets.test.ts`                     | 校验 PWA 配置与图标                                                     | 增加 ONNX 排除回归测试                     |
| `apps/web/src/components/tools/markdown-preview.tsx`       | 静态导入 `react-markdown`、`remark-gfm`、`rehype-highlight`             | 拆出按需加载的 Markdown 渲染器             |
| `apps/web/src/components/tools/zip-download-button.tsx`    | 静态导入 `jszip`                                                        | 点击下载时再动态导入                       |
| `apps/web/src/components/tools/result-download-action.tsx` | 只转发 `ZipDownloadButton`，不直接导入 JSZip                            | 无需为 JSZip 修改                          |
| `apps/web/src/lib/processing/image-client.ts`              | 静态导入 `browser-image-compression`，同时导出 `shouldProcessLocally()` | 拆出轻量策略模块，压缩库改为函数内动态导入 |
| `apps/web/src/components/effects/hero-workbench-scene.tsx` | 已有 `visibilitychange`、RAF 去重和资源清理，无 `IntersectionObserver`  | 增加可见性控制，离屏取消 RAF               |

当前三个图片页都从 `image-client` 导入 `shouldProcessLocally()`：

- `apps/web/src/app/[locale]/(app)/image/compress/page.tsx`
- `apps/web/src/app/[locale]/(app)/image/convert/page.tsx`
- `apps/web/src/app/[locale]/(app)/image/watermark/page.tsx`

其中 `compress` 页面还会导入 `compressImage`；`convert` 和 `watermark`
只做本地/服务端判断时，不应因为一个 5 MB 的纯判断把压缩库带进首包。

### D0 基线记录

在改动前执行生产构建，并把结果贴到 PR：

```powershell
cd apps/web
bun run build
```

记录以下数据：

1. `public/sw.js` 的 precache 条目数和总字节数。
2. `/onnx/**` 条目数。
3. 构建输出中的共享 First Load JS。
4. `/pdf/from-document`、`/pdf/to-text`、`/image/watermark`、`/image/compress`、`/image/convert`
   的 First Load JS。
5. 若需要定位 chunk，使用 `ANALYZE=true` 构建并保存报告到本地 `artifacts/`，不提交。

## 三、实施步骤

### A1. PWA 排除 `/onnx/**`

1. 在 `next.config.mjs` 增加一个可测试的排除函数，例如
   `excludeOnnxPrecache(entry)`，只匹配 URL 或资源名中的 `/onnx/` 路径。
2. 将函数加入 `pwaWorkboxOptions.exclude`，不要移除已有的 `excludeLargeStaticJsChunk`。
3. 不要用修改 `public/sw.js`、删除本地 `public/onnx/` 或增加运行时缓存规则的方式代替构建配置。
4. 在 `apps/web/test/pwa/pwa-assets.test.ts` 增加：
   - `/onnx/ort-wasm-simd.jsep.wasm` 被排除；
   - 普通 `_next/static/**` 资源不被误伤；
   - 原有超大 chunk 排除仍然存在。
5. 构建后检查生成的 `sw.js`，确认没有 `/onnx/` 字面量或 ONNX 文件条目。

**验收**：构建产物中 `/onnx/**` 条目为 0；首次预缓存总量不再包含约 61.68 MB 的 WASM。

### A2. 拆分图片处理策略并懒加载压缩库

1. 新建 `apps/web/src/lib/processing/image-processing-policy.ts`，只放：
   - `LOCAL_PROCESSING_MAX_BYTES = 5 * 1024 * 1024`；
   - `shouldProcessLocally(file: Pick<File, 'size'>): boolean`。
2. 将 `image-client.ts` 中的实现改为从策略模块导入并重新导出，避免其他调用方立即断裂。
3. 将三个页面改为从 `image-processing-policy` 导入 `shouldProcessLocally`。
4. 将 `compressImage()` 内的
   `const imageCompression = (await import('browser-image-compression')).default`
   放在函数体，删除顶部静态 import。
5. 保持 `CompressOptions`、返回值、Web Worker、EXIF 和格式校验行为不变。

**验收**：`/image/convert`、`/image/watermark` 不再因为 `shouldProcessLocally` 静态引入
`browser-image-compression`；`/image/compress` 点击压缩前才下载压缩库。

### A3. Markdown 与 JSZip 按需加载

1. 将 Markdown 渲染依赖拆到独立客户端组件，例如
   `apps/web/src/components/tools/markdown-renderer.tsx`，由它静态导入
   `react-markdown`、`remark-gfm`、`rehype-highlight`。
2. 在 `markdown-preview.tsx` 使用 `next/dynamic`
   延迟加载该渲染器。只有显示 Markdown 预览时才请求 chunk；纯文本模式、源码模式不得加载。
3. 保留外层
   `.markdown-body`，保留代码高亮和复制按钮。打印仍依赖该 class，不能用新的 wrapper 替换掉。
4. 给动态组件提供稳定占位，避免切换预览时出现明显 CLS。
5. 在 `zip-download-button.tsx` 删除顶部 `import JSZip from 'jszip'`，在 `handleDownload()`
   内动态导入。打包失败仍要进入 `finally` 并恢复按钮。
6. `result-download-action.tsx` 只是转发组件，不需要为了 JSZip 修改。

**验收**：`/pdf/from-document` 与 `/pdf/to-text`
的首包不再包含 Markdown 渲染依赖；ZIP 下载首次点击才加载 JSZip，下载内容和文件名去重规则不变。

### A4. Hero Three.js 可见性控制

1. 在挂载节点上创建 `IntersectionObserver`，以接近视口时预加载、真正不可见时暂停为原则。
2. 维护唯一状态源，例如 `isInViewport`。只有同时满足“在视口内”和
   `document.visibilityState === 'visible'` 时才允许调度 RAF。
3. 离开视口时：`cancelAnimationFrame(animationFrame)`，把 `animationFrame` 置 0，并
   `clock.reset(performance.now())`。不要在 `render()` 尾部无条件重新调度。
4. 回到视口时：先重置 clock，再调用一次 `scheduleNextFrame()`；利用现有 `!animationFrame`
   守卫，确保永远不会出现两个 RAF 循环。
5. 组件卸载时断开 observer、取消 RAF、移除事件监听，并保留现有 Three.js
   renderer 和 geometry/material 的释放逻辑。
6. 移动端和 `prefers-reduced-motion` 的现有分支保持不变。

**验收**：Hero 滚出视口 3 秒内 RAF 帧数为 0；滚回后动画连续且无重复加速；路由切换后无 WebGL
context 泄漏。

## 四、测试清单

按从快到慢顺序执行：

```powershell
bun --cwd apps/web test test/pwa/pwa-assets.test.ts
bun --cwd apps/web test
bun --cwd apps/web lint
bun --cwd apps/web build
bun run format:check:changed
```

补充手工回归：

1. 首装/清理站点数据后打开站点，DevTools Application 中确认 precache 不含 `/onnx/**`。
2. 打开 `/pdf/from-document`、`/pdf/to-text`，验证 Markdown 预览、代码高亮、复制和打印。
3. 打开 `/image/compress`、`/image/convert`、`/image/watermark`，分别验证本地处理与服务端处理分支。
4. 打开含 ZIP 下载的页面，验证多文件重名后缀、下载内容和按钮 loading 状态。
5. 在首页滚动 Hero 进出视口，Performance 面板确认离屏无 RAF，切后台再回来无重复循环。

## 五、验收标准

| 指标               | 通过条件                                      |
| ------------------ | --------------------------------------------- |
| PWA ONNX 预缓存    | `/onnx/**` 条目 = 0                           |
| 预缓存总量         | 相比 D0 减少约 61.68 MB（允许压缩后统计误差） |
| 共享 First Load JS | 不高于 D0 的 90.2 kB                          |
| 重点路由           | 因重库按需加载而受益的路由下降 ≥15%           |
| Markdown           | 预览、源码切换、代码高亮、复制、打印全部正常  |
| ZIP                | 下载内容、文件名、重名处理和错误恢复正常      |
| Hero               | 离屏 3 秒 RAF = 0，回屏后单循环运行           |
| 构建               | Web build、lint、测试全部通过                 |

## 六、回滚方式

- PWA：只回滚 `next.config.mjs` 的 ONNX 排除规则和对应测试，重新构建即可。
- 懒加载：还原对应组件的静态 import；不涉及数据、接口或缓存迁移。
- Hero：移除 `IntersectionObserver` 分支，恢复原有 `visibilitychange` 控制。
- 本批不产生数据库、API 或部署状态，回滚不需要清理服务端数据。

## 七、风险与注意事项

1. `public/sw.js` 是构建产物，禁止手改；PWA 改动只能落在构建配置。
2. Workbox 的排除规则要精确匹配 `/onnx/`，不可用过宽正则误伤 `_next` chunk。
3. `next/dynamic` 的 `ssr` 选择必须保证客户端组件和打印路径可用；不要在服务端渲染阶段读取 `window`
   或 `document`。
4. Markdown 动态化不能丢掉 `.markdown-body`，否则打印样式会静默退化。
5. JSZip 动态导入后要处理加载失败；按钮必须在 `finally` 中解除 loading。
6. `browser-image-compression` 的默认导入形态要按实际模块导出验证，不能只凭 TypeScript 通过。
7. Three.js 异步 `start()` 与组件卸载存在竞态：卸载后返回的 cleanup 也必须立即执行。
8. 不要顺手调整缓存时长、Service Worker fallback 或首页布局。
9. 改动前先保存 D0 数据；没有前后对比，不把“包体可能更小”写成已优化。

## 八、PR 合并检查清单

- [ ] 只修改 A 所有权内的文件。
- [ ] `sw.js` 未进入 Git，`public/onnx/` 未提交。
- [ ] PWA 回归测试覆盖 `/onnx/**` 排除。
- [ ] 三个图片页不再从重模块导入纯策略函数。
- [ ] Markdown 打印和代码高亮已手工验证。
- [ ] JSZip 只在点击后加载。
- [ ] Hero 离屏/回屏/卸载均无重复 RAF。
- [ ] 构建前后数据已写入 PR。
- [ ] `bun run format:check:changed` 通过。
- [ ] 提交信息使用中文。
