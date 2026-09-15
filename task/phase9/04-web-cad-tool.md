# 04 - Web PDF 转 CAD 工具

## 依赖

`00-cad-contract.md`、`03-task-backend.md`。

## 目标

提供 `/pdf/to-cad` 工具页，完成配置、任务提交、进度查看和结果下载。

## 负责范围

- `apps/web/src/app/[locale]/(app)/pdf/to-cad/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/to-cad/layout.tsx`
- `apps/web/src/lib/tools/tool-metadata.ts`
- `apps/web/src/hooks/api/types.ts`
- `apps/web/src/lib/tasks/task-category.ts`
- `apps/web/messages/zh.json`
- `apps/web/messages/en.json`
- `apps/web/test/`

## 实现要求

- 复用现有 PDF 上传、页面选择、任务提交、轮询和下载组件。
- 提供单位、比例、OCR、底图和图层策略配置。
- DXF 可提交；DWG 显示暂不支持并阻止提交。
- 展示任务进度、错误码、实体统计、OCR 统计和降级说明。
- 底图输出显示 ZIP 下载提示。
- 工具目录、PDF 首页、任务列表和双语文案同步。

## 测试与验收

- 页面渲染和表单默认值。
- DWG 禁用、错误展示、任务轮询和结果下载。
- messages parity、任务类型映射和工具元数据测试。
- 用户可从 PDF 工具入口完成 DXF 下载。
