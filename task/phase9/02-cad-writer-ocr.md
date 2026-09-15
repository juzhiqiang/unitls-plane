# 02 - DXF Writer 与 OCR

## 依赖

`00-cad-contract.md`、`01-cad-core.md`。

## 目标

把 CAD 中间模型写为可被主流 CAD 软件打开的 DXF，并提供扫描页 OCR/底图能力。

## 负责范围

- `apps/api/src/modules/tasks/services/cad/dxf-writer.ts`
- `apps/api/src/modules/tasks/services/cad/cad-writer.ts`
- `apps/api/src/modules/tasks/services/cad/tesseract-ocr.ts`
- `apps/api/src/modules/tasks/services/cad/raster-underlay.ts`
- 对应 `apps/api/test/modules/tasks/services/cad/` 测试

## 实现要求

- DXF 输出图层表、线型表、文字样式、单位头信息和页面边界。
- 支持 `LINE`、`LWPOLYLINE`、`ARC`、`CIRCLE`、`HATCH`、`TEXT`、`MTEXT`、`INSERT`。
- writer 接口必须可替换；DWG writer 仅抛出 `CAD_DWG_UNSUPPORTED`，不能输出伪成功文件。
- Tesseract 不可用时抛出 `CAD_OCR_UNAVAILABLE`，不得静默跳过 OCR。
- OCR 文字和线段识别结果标记为 `ocr` 或 `inferred`。
- 开启底图时输出 PNG 资源及 ZIP；关闭时 DXF 不引用外部资源。

## 测试

- DXF 文本结构和开源 DXF 解析器回读。
- 图层、线型、文字样式、实体数量和单位头信息。
- DWG 明确失败、OCR 不可用、中文 OCR、底图 ZIP 资源。

## 验收

DXF 能被 LibreCAD/QCAD/AutoCAD 打开，线、圆、折线、文字和图层可编辑。
