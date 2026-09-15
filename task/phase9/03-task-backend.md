# 03 - API、任务队列与数据库接入

## 依赖

`00-cad-contract.md`、`01-cad-core.md`、`02-cad-writer-ocr.md`。

## 目标

把 CAD 转换接入现有任务创建、BullMQ、文件存储、重试和 OpenAPI 链路。

## 负责范围

- `packages/db/src/schema/tasks.ts`
- `packages/db/drizzle/`
- `packages/validators/src/tasks.ts`
- `apps/api/src/modules/tasks/`
- `packages/api-client/`
- `apps/api/test/modules/tasks/`

## 实现要求

- 所有任务类型白名单、PDF 类别映射和队列路由加入 `pdf_to_cad`。
- 生成并执行 Drizzle migration。
- `PdfProcessor` 增加 `handleToCad`，校验 PDF、50MB、500 页、页码、比例和格式。
- 按解析、OCR、写出阶段更新任务进度。
- 输出 DXF 或带底图资源的 ZIP，使用现有 output owner 和文件上传流程。
- `outputMeta` 写入页数、实体数、OCR 数、单位、降级原因和版本。
- 失败、重试、DWG 不支持和 OCR 缺失必须正确反映任务状态。
- 导出 OpenAPI 并刷新 `packages/api-client`。

## 测试

- schema、validator、DTO、队列路由。
- processor 成功、失败、重试和输出文件。
- DWG/OCR 错误码不会生成输出文件。
- OpenAPI 与客户端类型包含新任务类型。

## 验收

通过现有 API 创建任务后，能够排队、处理、查询进度、获取输出文件和读取转换元数据。
