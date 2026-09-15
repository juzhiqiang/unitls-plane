# 01 - PDF CAD 核心解析

## 依赖

`00-cad-contract.md`。

## 目标

实现不依赖 Nest 任务生命周期的 PDF Buffer 到 `CadDocument` 转换器。

## 负责范围

- `apps/api/src/modules/tasks/services/cad/pdf-cad-extractor.service.ts`
- `apps/api/src/modules/tasks/services/cad/geometry.ts`
- `apps/api/src/modules/tasks/services/cad/layer-mapper.ts`
- `apps/api/test/modules/tasks/services/cad/`

## 实现要求

- 使用现有 MuPDF 动态加载方式读取页面对象。
- 支持路径拆解为 line、polyline、arc、circle；支持填充、文字、图片占位和页面边界。
- 处理页面旋转、PDF 左上坐标到 CAD 左下坐标、单位换算和比例。
- `layerMode: source` 按来源对象/颜色/字体生成稳定图层；`semantic` 只做确定性规则映射。
- 每个实体保留 `source: 'pdf' | 'ocr' | 'inferred'`。
- 输出实体计数、页数、无法恢复对象和降级原因。
- 对损坏 PDF、空页、超页码、超实体预算返回契约错误。

## 测试

- 坐标翻转、毫米/英寸换算、比例和旋转页。
- 线、折线、圆弧、圆、填充、中文文字和页面边界。
- 空页、无路径页、非法页码、实体预算超限。
- 三类 fixture 的稳定实体统计。

## 验收

给定相同 PDF 和配置，输出模型坐标和实体顺序稳定；不涉及队列、文件上传或前端。
