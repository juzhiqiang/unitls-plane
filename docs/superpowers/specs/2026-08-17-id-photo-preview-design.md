# 证件照生成页面预览功能设计

- 日期:2026-08-17
- 关联页面:`apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`
- 关联设计:[2026-07-07-id-photo-generator-design](./2026-07-07-id-photo-generator-design.md)

## 背景

证件照生成页(`/image/id-photo`)当前两处缺少预览:

1. 上传文件后只显示文件名文字(`page.tsx:136-141`),看不到原图。
2. 任务完成后 `ResultPanel` 预留的 `preview` 插槽未被使用(`result-panel.tsx:7,20`),结果只显示文件名 + 大小 + 下载按钮,看不到证件照成品。

`IdPhotoOptions` 状态里的 `crop` 字段(`id-photo-options.tsx:13`)UI 未暴露,本次不引入裁剪交互。

## 目标

补两处预览:

- **上传原图预览**:选完文件即看到原图缩略。
- **生成结果预览**:任务完成即看到证件照成品图。

## 非目标

- 背景色实时对比(后端不返回透明前景,见约束)。
- 裁剪构图交互(用户未选)。

## 约束

后端 `IdPhotoService.render` 输出已合成背景色的 JPEG/PNG(`id-photo.service.ts:524-547`),中间的透明前景(同文件 `519-522`)不外返。因此结果预览只能展示成品,无法在前端本地换底。要对比不同底色,只能在配置阶段选不同背景各跑一次(现状)。

## 方案

**方案 A:仅在证件照页面内加预览,不改动通用 `FileDropzone`。** 改动面最小,不影响 PDF 等不需要原图预览的工具。后续若其他工具有复用需求,再抽独立 `ImagePreview` 组件。

## 设计

### 上传原图预览

- 位置:`id-photo/page.tsx` 中 `file` 存在区块(第 134 行起),在文件名文字行上方加 `<img>`。
- 数据源:`URL.createObjectURL(file)`。
- 生命周期:用 `useEffect` 在 `file` 变化时 revoke 旧 URL、创建新 URL;组件卸载时 revoke,防止内存泄漏。
- 样式:`max-h-64 w-auto object-contain rounded-md border`。

### 生成结果预览

- 位置:`ResultPanel` 调用处(`page.tsx:177`)传入 `preview` 插槽。
- 数据源:`URL.createObjectURL(resultFile)`。
- 生命周期:用 `useEffect` 管理 `resultFile` 的 objectURL(创建/revoke)。
- 复用 `ResultPanel` 已有 `preview` prop。

### i18n

- 新增 `ImageIdPhoto.previewAlt` 文案 key,中英文 `messages/zh.json` 与 `en.json` 同步。
- 上传预览与结果预览可共用该 alt 文案。

## 错误处理

- `URL.createObjectURL` 针对有效 `File` 几乎不会失败,不额外处理。
- `<img>` 的 `onError` 兜底文字本次不加(YAGNI)。

## 测试

- 在证件照页面现有测试中补充断言:
  - `file` 存在时上传预览 `<img>` 出现且 `src` 非空。
  - `resultFile` 存在时 `ResultPanel` 内 `<img>` 出现且 `src` 非空。
- objectURL 生命周期(卸载 revoke)不单独测试,依赖实现正确性。

## 实现影响范围

- `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`(主要改动)
- `apps/web/messages/zh.json`、`apps/web/messages/en.json`(新增 alt key)
- 对应页面测试文件(若存在)
