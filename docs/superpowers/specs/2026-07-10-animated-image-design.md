# 图片动画工具商业化设计

## 背景

图片模块计划新增 GIF 制作、GIF 压缩，并预留 APNG 能力。该功能面向电商动图、社媒素材、表情包、产品卖点循环展示、轻量广告图和上传体积受限场景。

现有图片模块已经包含压缩、转换、水印、证件照和长图拼接。压缩、转换、水印、长图拼接偏向浏览器本地或 local-first 处理；证件照和更重的文件任务走服务端。GIF/APNG 与静态图片不同，涉及多帧解码、帧率、调色板、透明度、循环次数、输出体积和浏览器性能限制。因此首版应把工具设计成“动画图片”分组下的统一入口，而不是散落到压缩或转换工具里。

## 产品定位

新增图片分组：动画图片。

新增工具入口：GIF/APNG 制作与压缩。

推荐路由：

- `/image/animation`

页面采用一个工具页、多个模式的结构：

- 制作：多张图片合成 GIF，登录商业版优先支持 APNG 和更高限制。
- 压缩：上传 GIF，调整尺寸、帧率和质量，登录商业版支持更大文件和高级参数。
- 转换：作为后续扩展入口，承载 GIF/APNG/WebP 动图之间的互转。

首版重点是“制作 + 基础压缩”。转换模式可以先保留轻量入口和能力说明，但不应阻塞核心制作流程。

## 商业化分层

### 未登录用户：免费版

免费版用于承接自然流量和快速试用，强调隐私、低门槛和即时下载。

- 浏览器本地处理，不上传文件。
- 支持多张 PNG、JPEG、WebP 图片制作 GIF。
- 支持拖拽排序、删除、预览。
- 支持统一画布尺寸、背景色、帧间隔、循环次数。
- 支持基础 GIF 压缩：缩放尺寸、降低帧率或质量档位。
- 限制文件数量、单文件大小、总像素、最大帧数和输出尺寸。
- 结果只提供本次下载，不保存历史。

免费版不强制加平台水印。商业化主要通过更高限制、APNG、高级压缩、批量处理、历史记录和模板能力承接。

### 登录用户：商业版

登录用户按商业版实现。现阶段不单独区分“商业预览”和“后续付费版”，也不接真实支付系统；登录身份就是当前商业权益判断。未来接入支付时，只需要把同一套权益判断从“是否登录”迁移到“是否拥有订阅或套餐”。

商业版能力：

- 免费版全部能力。
- 更高文件数量、单文件大小、最大帧数和输出尺寸限制。
- APNG 输出优先纳入首版实现；如果浏览器端编码库验证不稳定，则保留商业权益和 UI 入口，并给出明确降级提示。
- 更细的帧间隔、循环次数、透明背景和背景色设置。
- 高级压缩参数：目标宽度、目标帧率、质量档位、颜色数量、是否保留透明。
- 批量处理入口和任务历史入口 UI。
- 输出命名规则。
- 为后续服务端高质量压缩、云端保存和团队素材库预留权益字段。

## 首版范围

首版建议实现一个工具页：

- 工具名：GIF/APNG 制作与压缩。
- 路由：`/image/animation`。
- 分类：`imageAnimation`。
- processing：`local-first`。
- retention：未登录为 `browser-session`，登录商业版预留 `account-files`。
- requiresLogin：`false`。
- tags：`gif`、`apng`、`animation`、`compress`。

工具目录中新增“动画图片”分组。该分组可以放在图片压缩、图片转换之后，长图拼接附近，体现它属于图片生产和优化工具。

## 用户流程

### 制作模式

1. 用户进入 `/image/animation`。
2. 默认选中“制作”模式。
3. 上传多张图片，至少 2 张才允许生成动画。
4. 页面展示帧列表，支持拖拽排序、删除和查看单帧信息。
5. 用户设置输出格式、画布尺寸、帧间隔、循环次数、背景色和质量。
6. 点击生成。
7. 浏览器本地读取图片，按顺序绘制到 canvas 或编码器输入帧。
8. 输出 GIF；登录商业版可输出 APNG。
9. 页面展示结果大小、帧数、尺寸、预览和下载按钮。

### 压缩模式

1. 用户切换到“压缩”模式。
2. 上传 GIF 文件。
3. 页面读取文件信息，并提示当前能力边界。
4. 用户设置目标宽度、帧率或质量档位。
5. 浏览器本地执行基础压缩。
6. 输出压缩后的 GIF，并显示压缩前后体积对比。
7. 登录商业版显示更高限制和高级参数。

### 转换模式

首版转换模式只做轻量入口：

- 制作模式中可通过输出格式选择 GIF 或 APNG。
- 压缩模式中暂不承诺完整 GIF/APNG 互转。
- 页面可以展示“转换能力将复用当前动画处理链路扩展”，但不要影响首版可用性。

## 权益判断

建议新增统一权益函数：

- `getImageAnimationEntitlements(session)`

返回字段：

- `isLoggedIn`
- `isCommercial`
- `maxInputFiles`
- `maxFileSize`
- `maxFrames`
- `maxCanvasPixels`
- `maxOutputWidth`
- `canExportGif`
- `canExportApng`
- `canUseAdvancedCompression`
- `canBatchProcess`
- `canSaveHistory`

首版规则：

- 未登录：`isCommercial = false`，只开放免费限制内的 GIF 制作和基础压缩。
- 已登录：`isCommercial = true`，开放商业版 UI 和商业版限制。

未来接入支付时，不改页面主流程，只把 `isCommercial` 改成订阅权益判断。

## 架构设计

### 前端页面

新增页面：

- `apps/web/src/app/[locale]/(app)/image/animation/page.tsx`

复用现有工具页结构：

- `ToolPageShell`
- `FileDropzone`
- `ProcessingProgress`
- `ResultPanel`
- `DownloadButton`
- 现有 i18n 体系

页面状态：

- 当前模式：制作、压缩、转换。
- 输入文件列表。
- 帧排序列表。
- 免费版配置。
- 商业版配置。
- 处理进度。
- 结果文件。
- 错误信息。

### 动画帧列表

建议新增动画图片专用列表组件：

- `apps/web/src/components/tools/animation-frame-list.tsx`

职责：

- 使用 `@dnd-kit` 支持帧排序。
- 展示缩略图、文件名、尺寸、大小和序号。
- 支持删除帧。
- 不包含编码业务逻辑。

### 本地处理模块

建议新增：

- `apps/web/src/lib/processing/image-animation-client.ts`

建议导出：

- `createGifFromImages(files, options): Promise<File>`
- `compressGif(file, options): Promise<File>`
- `estimateAnimationOutput(files, options): Promise<AnimationEstimate>`
- `getAnimationOutputName(options): string`

核心类型：

- `AnimationMode = 'create' | 'compress' | 'convert'`
- `AnimationOutputFormat = 'gif' | 'apng'`
- `AnimationCreateOptions`
- `AnimationCompressOptions`
- `AnimationEntitlements`

### 编码库策略

首版优先使用浏览器端 GIF 编码库，避免新增服务端任务类型、数据库 enum、OpenAPI 导出和队列处理器复杂度。

选择编码库时重点看：

- 是否支持浏览器环境和 Web Worker。
- 是否支持从 canvas/imageData 添加帧。
- 打包体积是否可接受。
- 是否能配置 delay、repeat、quality 或 palette。
- 是否有 TypeScript 类型或容易封装。

APNG 编码生态比 GIF 弱，首版可作为登录商业能力实现，但需要在实现计划阶段验证具体库的稳定性。如果 APNG 库不可靠，设计允许先保留商业版 APNG UI 和权益判断，再以明确提示说明当前浏览器不支持或该能力稍后开放。

## 数据流

制作模式：

```text
FileDropzone -> AnimationFrameList -> create options -> createGifFromImages/createApngFromImages -> ResultPanel -> DownloadButton
```

压缩模式：

```text
FileDropzone -> gif metadata/preview -> compression options -> compressGif -> compare result -> DownloadButton
```

登录商业版：

```text
auth session -> animation entitlements -> commercial options -> local processing -> result download/history placeholder
```

未来服务端高质量压缩：

```text
upload file -> create animation task -> image queue -> animated processor -> output file -> task history
```

## 服务端策略

首版不新增服务端 task type。

原因：

- 当前服务端图片处理主要基于 Sharp，适合静态图片压缩、转换和水印。
- 高质量 GIF/APNG 压缩通常需要多帧解码、调色板优化、帧去重、帧率调整和格式专用优化。
- 服务端方案可能引入 `ffmpeg`、`gifsicle`、`apngasm`、`apngopt` 或 WASM/原生依赖，部署和运行成本高。
- 新增服务端任务需要同步修改 DB enum、validators、DTO、queue routing、processor、OpenAPI 和 api-client。

后续当商业版需要稳定高质量压缩时，再新增服务端任务：

- `image_animation_create`
- `image_animation_compress`
- `image_animation_convert`

## 错误处理

需要覆盖：

- 上传文件不是支持的图片或 GIF。
- 制作模式少于 2 张图片。
- 免费版超出文件数量、大小、帧数或像素限制。
- 图片读取失败或文件损坏。
- GIF 解码失败。
- 浏览器不支持当前编码能力。
- APNG 编码能力不可用。
- 处理耗时过长或内存不足。
- `canvas.getContext` 或导出失败。

错误展示复用现有失败恢复组件，提供重试、移除问题文件和重置入口。

## 测试策略

处理函数测试：

- 制作模式参数校验。
- 帧间隔、循环次数、输出格式映射。
- 权益限制校验。
- 输出文件名生成。
- 超出最大帧数或最大像素时抛出明确错误。

组件测试：

- 模式切换正确。
- 上传后展示帧列表。
- 少于 2 张图片时禁用生成。
- 未登录时 APNG 和高级压缩不可用。
- 登录时商业版配置显示并可操作。
- 压缩结果显示前后体积对比。

集成检查：

- 工具目录包含 `/image/animation`。
- 中英文文案 key 完整。
- 免费用户可以完成 GIF 制作。
- 登录用户看到商业版能力。

## 非目标

首版不实现真实支付。

首版不强制服务端处理 GIF/APNG。

首版不承诺高质量 GIF 体积最优。

首版不实现视频转 GIF。

首版不实现完整 GIF/APNG/WebP 动图互转矩阵。

首版不保存免费用户处理历史。

## 后续演进

1. 服务端高质量 GIF 压缩：接入专用动画优化器，提升压缩率和稳定性。
2. APNG 深度支持：完善 APNG 压缩、转换和透明动画保真。
3. WebP 动图输出：为现代浏览器和社媒场景提供更小体积输出。
4. 视频转 GIF：从短视频截取动画片段。
5. 模板化动图：电商价格牌、促销标签、产品循环展示模板。
6. 订阅权益：把登录即商业版迁移到真实 plan/paid entitlement。

## 自检结论

本设计聚焦单一图片分组和单一工具页 `/image/animation`。免费版和登录商业版边界明确，且未来支付系统可以通过权益判断平滑接入。首版以浏览器本地处理为主，避免立即引入服务端动画依赖和任务链路改造；APNG 作为商业能力预留，并在实现计划阶段验证具体浏览器端编码方案。
