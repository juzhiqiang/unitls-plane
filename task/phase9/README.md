# Phase 9：PDF 转 CAD

## 目标

在现有 PDF 服务端任务体系中新增 `pdf_to_cad`。首版生成工程级 DXF，保留 DWG writer 适配边界；扫描 PDF 通过可选 OCR 和栅格底图降级处理。

## 执行顺序

1. `00-cad-contract.md`
2. `01-cad-core.md`
3. `02-cad-writer-ocr.md`
4. `03-task-backend.md`（依赖 01、02 的稳定接口）
5. `04-web-cad-tool.md`（依赖 03 的任务契约）
6. `05-docs-deploy-validation.md`

01 与 02 可在 00 完成后并行；03 必须等 01、02 的公共接口稳定。

## 协作约束

- 公共类型、配置字段和错误码只由 00 确定。
- 各 agent 只修改自己任务文件中声明的目录。
- 不实现正式 DWG 写出；DWG 必须返回 `CAD_DWG_UNSUPPORTED`。
- 每项完成后提交中文 commit，并附测试命令和结果。
