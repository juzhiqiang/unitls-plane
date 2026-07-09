# 图片长图拼接商业化设计

## 背景

图片模块需要新增“长图拼接”能力。该能力面向电商详情页、社媒长图、教程截图、产品发布图等高频素材生产场景，不只做通用图片合并，而是围绕“统一宽度、稳定排版、可发布输出”建立商业化基础。

现有图片工具主要位于 `apps/web`，压缩、转换、水印等工具已经支持浏览器本地处理。长图拼接首版应优先复用前端工具页结构和本地 canvas 处理链路，避免引入新的 API task 类型、OpenAPI 生成和服务端处理器复杂度。

## 商业化分层

### 未登录用户：免费版

免费版用于降低试用门槛，并作为图片工具入口的自然流量承接。

- 本地浏览器处理，不上传文件。
- 支持多图上传。
- 支持拖拽排序。
- 支持竖向拼接。
- 支持统一宽度，默认推荐电商/社媒常见宽度。
- 支持间距和背景色。
- 支持 PNG、JPEG、WebP 导出。
- 有清晰的文件数量、单文件大小和总画布尺寸限制。
- 结果只提供单次下载，不保存历史。

免费版不应强制加平台水印。水印会降低工具可信度和转化体验。后续商业化更适合围绕更大额度、批量、模板、历史记录和团队能力收费。

### 登录用户：商业版基础

登录用户按商业版能力实现，但首期可以不接真实支付系统。登录身份用于承载未来套餐、权益、云端文件和任务记录。

- 免费版全部能力。
- 更高文件数量、单文件大小和画布尺寸限制。
- 支持批量输出多种宽度，例如 750、1080、1242、自定义宽度组合。
- 支持品牌页尾、角标、水印模板等品牌化设置。
- 支持输出文件命名规则。
- 支持处理记录进入文件管理或任务历史，具体是否入库由实现阶段结合现有文件体系确定。
- 预留权益判断函数，例如 `canUseImageStitchCommercialFeatures(session)`，后续可接入 plan 字段或支付套餐。

登录用户不是简单“解除登录限制”，而是产品上被定义为商业素材生产模式。这样后续收费时可以平滑把部分能力从“登录可用”迁移到“付费套餐可用”。

## 推荐首版范围

首版工具名称建议为“长图拼接”。

路由建议为：

- `/image/stitch`

工具目录建议新增图片分类：

- 分类：`imageCompose`
- 中文标题：`拼接`
- 英文标题：`Compose`

工具入口：

- key：`imageStitch`
- title：`长图拼接`
- processing：未登录展示 `local` 或 `local-first`，实际首版处理为本地。
- retention：未登录 `browser-session`，登录商业版可在后续实现中扩展到 `account-files`。
- requiresLogin：`false`，因为免费版无需登录。
- tags：`stitch`、`long-image`、`ecommerce`。

## 用户流程

1. 用户进入 `/image/stitch`。
2. 上传多张图片，至少 2 张才可开始拼接。
3. 页面显示图片缩略图排序列表。
4. 用户拖拽调整顺序，也可以移除图片。
5. 用户配置拼接参数。
6. 点击生成长图。
7. 浏览器本地读取图片、按统一宽度缩放并绘制到 canvas。
8. 生成单个图片文件。
9. 页面展示结果信息、预览和下载按钮。
10. 登录用户看到商业版增强选项，未登录用户看到登录引导但不阻塞免费能力。

## 配置项

### 免费版配置

- 拼接方向：首版默认竖向，可在界面中暂不提供横向。
- 输出宽度：750、1080、1242、自定义。
- 图片对齐：默认居中。由于统一宽度缩放，首版通常无需额外对齐选项。
- 图片间距：0、8、16、24、自定义。
- 背景色：透明、白色、黑色、自定义色。JPEG 输出时透明背景自动转白色。
- 输出格式：PNG、JPEG、WebP。
- JPEG/WebP 质量：1-100。
- 输出文件名：默认 `stitched-long-image.{ext}`。

### 登录商业版配置

- 多尺寸批量导出：一次生成多个宽度版本。
- 品牌页尾：可添加固定高度页尾、品牌名、联系方式或版权文案。
- 角标/水印模板：复用图片水印处理思路，但作为长图整体后处理。
- 命名规则：支持前缀、日期和宽度占位符。
- 处理记录：未来可保存到账号文件或任务历史。

商业版配置应通过 UI 分组展示。未登录用户可以看到商业能力入口和登录提示，但不应影响基础拼接完成。

## 架构设计

### 前端页面

新增页面：

- `apps/web/src/app/[locale]/(app)/image/stitch/page.tsx`

页面复用：

- `ToolPageShell`
- `FileDropzone`
- `ProcessingProgress`
- `ResultPanel`
- `DownloadButton`
- 现有 i18n 体系

页面新增状态：

- 上传图片列表
- 排序后的图片顺序
- 免费版拼接配置
- 商业版配置
- 处理进度
- 单个结果文件或批量结果文件
- 错误信息

### 排序列表组件

现有 `SortableFileList` 绑定了 PDF 缩略图渲染，不适合直接用于图片。建议新增图片专用组件：

- `apps/web/src/components/tools/sortable-image-list.tsx`

职责：

- 使用 `@dnd-kit` 支持拖拽排序。
- 生成图片缩略图。
- 显示文件名、大小、序号。
- 支持移除。
- 不包含拼接业务逻辑。

后续如果 PDF 和图片排序列表重复明显，再抽象通用排序容器；首版不为了抽象而扩大改动面。

### 处理函数

新增处理文件：

- `apps/web/src/lib/processing/image-stitch-client.ts`

建议导出：

- `stitchImages(files, options): Promise<File>`
- `estimateStitchedCanvas(files, options): Promise<{ width; height }>`
- `getStitchOutputName(options): string`

核心类型：

- `ImageStitchDirection = 'vertical'`
- `ImageStitchOutputType = 'image/png' | 'image/jpeg' | 'image/webp'`
- `ImageStitchOptions`

处理逻辑：

1. 加载所有图片。
2. 读取自然宽高。
3. 按输出宽度计算每张图的目标宽高。
4. 汇总总画布高度：所有目标高度 + 间距。
5. 校验画布尺寸和像素总量。
6. 创建 canvas。
7. 填充背景色。
8. 按顺序绘制每张图片。
9. 使用 `canvas.toBlob` 导出目标格式。
10. 返回 `File`。

### 权益判断

首期可在前端提供轻量函数：

- `getImageStitchEntitlements(session)`

返回：

- `isLoggedIn`
- `maxFiles`
- `maxFileSize`
- `maxCanvasPixels`
- `canBatchExport`
- `canUseBrandFooter`
- `canUseWatermarkTemplate`
- `canSaveHistory`

未登录用户与登录用户的差异通过该函数集中控制。后续接入真实套餐时，只需把 session 中的 plan 或 API 返回的权益映射到同一结构。

## 数据流

免费版：

```text
FileDropzone -> SortableImageList -> options -> stitchImages -> ResultPanel -> DownloadButton
```

登录商业版：

```text
auth session -> entitlement -> commercial options -> stitchImages/batch -> result download
```

如果后续需要云端保存：

```text
result File -> upload file API -> files/tasks record -> account history
```

首版不要求服务端参与合成，避免一次性引入队列、任务类型和服务端图片库。

## 错误处理

需要覆盖以下错误：

- 上传文件不是支持的图片格式。
- 图片数量不足 2 张。
- 单文件超过当前权益限制。
- 读取图片失败或图片损坏。
- 目标画布尺寸超过浏览器限制。
- `canvas.getContext` 不可用。
- `canvas.toBlob` 导出失败。
- JPEG/WebP 不支持透明背景时自动降级为白底并提示。

错误展示复用 `FailureRecoveryPanel`，支持重试和重置。

## 测试策略

处理函数测试：

- 竖向拼接尺寸计算正确。
- 间距计入总高度。
- 输出类型映射正确。
- JPEG 透明背景自动使用白底。
- 画布过大时抛出明确错误。

组件测试：

- 图片列表可展示、移除和排序。
- 未登录时商业功能不可直接启用，但免费功能可用。
- 登录时商业配置显示。
- 少于 2 张图片时生成按钮禁用。

集成测试：

- 工具目录包含 `/image/stitch`。
- 中英文文案 key 完整。
- 页面能从上传进入配置，再进入结果状态。

## 非目标

首版不实现智能重叠去除。

首版不实现横向拼接。

首版不实现真实支付。

首版不强制上传文件到服务端。

首版不把免费用户结果加平台水印。

## 后续演进

1. 智能截图拼接：自动识别重叠区域，适合手机长截图和网页截图。
2. 电商模板：首图、参数区、详情区、页尾组件化生成。
3. 云端超大图处理：为大批量和超大画布提供服务端任务。
4. 套餐系统：将登录商业版能力迁移到 plan/paid entitlement。
5. 团队素材库：复用账号文件体系保存品牌模板和历史输出。

## 自检结论

本设计聚焦单个工具 `/image/stitch`，没有依赖真实支付系统，也没有要求新增后端任务。免费版与登录商业版的边界明确，后续收费可以通过权益判断逐步收敛。首版范围可控，适合在现有图片模块中增量实现。
