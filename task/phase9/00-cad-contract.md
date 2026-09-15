# 00 - CAD 公共契约

## 目标

定义 PDF 转 CAD 的跨模块类型、配置、错误码、坐标约定和 fixture，后续任务不得自行改名或改变语义。

## 负责范围

- `packages/validators/src/` 中可复用的 CAD 配置 schema（如适合则新增独立文件并从入口导出）。
- `apps/api/src/modules/tasks/services/cad/types.ts`。
- `apps/api/test/modules/tasks/services/cad/fixtures/` 的 fixture 说明或最小样本。

## 契约

任务类型为 `pdf_to_cad`。`inputConfig` 使用：

```ts
{
  format: 'dxf' | 'dwg';
  pages?: number[];
  unit?: 'mm' | 'inch';
  scale?: number;
  ocr?: boolean;
  includeRasterUnderlay?: boolean;
  layerMode?: 'source' | 'semantic';
}
```

默认值：`format: 'dxf'`、`unit: 'mm'`、`scale: 1`、`ocr: false`、`includeRasterUnderlay: false`、`layerMode: 'source'`。

至少定义：

- `CadDocument`：版本、单位、页面、图层、文字样式和转换元数据。
- `CadPage`：页面尺寸、旋转角度和实体列表。
- `CadEntity`：line、polyline、arc、circle、hatch、text、mtext、insert、image-underlay。
- `CadWriter.write(document): Promise<CadWriteResult>`。
- `CadConversionMeta`：页数、实体数量、OCR 数量、降级原因和转换器版本。

错误码固定为：`CAD_INVALID_CONFIG`、`CAD_OCR_UNAVAILABLE`、`CAD_DWG_UNSUPPORTED`、`CAD_CONVERSION_FAILED`。

坐标约定：输入 PDF 使用左上原点和 point；中间模型及 DXF 使用左下原点；页面高度参与 Y 轴翻转；所有坐标先按 point 转目标单位，再乘 `scale`；页面旋转在实体转换前统一处理。

## 验收

- 类型和 schema 可被 01、02、03 直接导入。
- 默认值、边界值和错误码有测试。
- 明确区分 PDF 原生实体与 OCR/启发式推断实体。
- 记录三类 fixture：矢量线图、中文标注图、扫描图，并写出预期实体统计。
