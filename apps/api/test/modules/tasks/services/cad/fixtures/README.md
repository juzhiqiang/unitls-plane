# PDF 转 CAD fixture 说明

三类 fixture 全部由 `index.ts` 在测试运行时确定性生成(pdf-lib + MuPDF +
sharp),不提交二进制。下表是默认配置(`dxf` / `mm` / `scale 1` / `layerMode source`
/ 不开 OCR 与底图)下的预期实体统计, 01(解析器)、02(写出器)、03(处理器)的断言都以此为准。

## vector-lines(矢量线图)

300×200 pt,一页,页面类型 `vector`。

| PDF 对象                             | 中间模型实体                                | source     |
| ------------------------------------ | ------------------------------------------- | ---------- |
| 红色实线 (10,10)→(290,10)            | `line`,图层 `STROKE_FF0000`                 | `pdf`      |
| 黑色实线 (10,10)→(10,190)            | `line`,图层 `STROKE_000000`                 | `pdf`      |
| 黑色虚线 (10,190)→(290,190),dash 4/2 | `line`,图层 `STROKE_000000_DASHED`,`DASHED` | `pdf`      |
| 蓝色描边矩形 50,50 100×60            | 闭合 `polyline`(4 顶点)                     | `pdf`      |
| 黑色描边圆 圆心 (220,120) r=30       | `circle`(4 段贝塞尔拟合)                    | `pdf`      |
| 绿色填充矩形 200,20 60×20            | `hatch`(1 个 loop)                          | `pdf`      |
| 黑色填充细条 20,100 120×0.8          | `line`(thin_fill_as_line,线宽 0.282mm)      | `inferred` |
| 文字 "A1" Helvetica 12pt             | `text`,样式 `HELVETICA`                     | `pdf`      |
| 页面边界                             | 闭合 `polyline`,图层 `FRAME`                | `pdf`      |

合计 9 个实体:`line 4`、`polyline 2`、`circle 1`、`hatch 1`、`text 1`;`pdf 8`、`inferred 1`。降级原因:`thin_fill_as_line ×1`。

坐标校验点(mm):红线起点 (3.527778, 3.527778),圆心 (77.611111, 42.333333),半径 10.583333。

## chinese-annotation(中文标注图)

300×200 pt,一页,页面类型 `vector`。中文由 MuPDF 内置的 Droid Sans
Fallback 排版并子集化嵌入, 不依赖系统字体。

| PDF 对象                       | 中间模型实体                            | source |
| ------------------------------ | --------------------------------------- | ------ |
| 文字 "尺寸标注 直径50" 14pt    | `text`,样式 `DROID_SANS_FALLBACK`       | `pdf`  |
| 文字 "Note: 中文注释" 10pt     | `text`,样式 `NIMBUS_SANS`(拉丁字符占多) | `pdf`  |
| 黑色实线 (20,60)→(200,60)      | `line`                                  | `pdf`  |
| 黑色实线 (200,60)→(240,100)    | `line`                                  | `pdf`  |
| 黑色描边圆 圆心 (240,130) r=25 | `circle`                                | `pdf`  |
| 页面边界                       | 闭合 `polyline`,图层 `FRAME`            | `pdf`  |

合计 6 个实体:`line 2`、`circle 1`、`text 2`、`polyline 1`;全部 `pdf`。无降级。

两段文字字号不同(14pt / 10pt),因此保持为两个独立 `text` 而不是合并成 `mtext`。

## scanned(扫描图)

400×300 pt,一页,只有一张整页 PNG(800×600 像素,白底):

- 横线:像素 y=297~303,x 60~740(粗 6px)
- 竖线:像素 x=97~103,y 80~520(粗 6px)
- 文字 "SCAN 123",48px,基线 y=200

默认配置下页面类型 `raster`,合计 2 个实体:`image-underlay 1`(`placeholder: true`)、`polyline 1`
(页面边界);降级原因 `raster_page`。

开启 `includeRasterUnderlay` 后底图实体带 `resource`(PNG),写出为 ZIP。开启 `ocr`
后由 Tesseract 识别 "SCAN 123" 并生成 `source: ocr` 的 `text`;栅格线段推断应得到 1 条横线 +
1 条竖线 (`source: inferred`,`origin: raster`)。
