# 05 - 文档、部署与最终验证

## 依赖

01、02、03、04 全部完成。

## 目标

完成生产依赖、文档、兼容性和端到端验收。

## 负责范围

- `README.md`
- `PROJECT_SPECS.md`
- Docker/生产镜像配置
- `artifacts/` 下的本地验证产物
- 最终测试报告

## 实现要求

- 文档加入 PDF 转 CAD、DXF 首版范围、OCR、底图、限制和 DWG 状态。
- 生产镜像加入 Tesseract 及中文/英文语言包；记录 MuPDF、Tesseract、DXF writer 版本和许可。
- 准备矢量线图、中文标注图、扫描图三类样本。
- 执行 API、Web、migration、OpenAPI、DXF 回读和端到端测试。
- 检查失败任务无假成功文件，匿名/登录文件保留策略不被破坏。
- 汇总坐标、单位、OCR 误差、PDF 语义推断和 DWG 未支持限制。

## 验收

- DXF 可被 LibreCAD/QCAD/AutoCAD 打开。
- 线、圆、折线、文字和图层可编辑。
- 扫描件 OCR、底图 ZIP 和降级提示一致。
- 数据库、API、Web、任务列表、双语文案和文档全部同步。
