# PDF 维护性重构结果

日期：2026-11-05。范围：实施计划 Task 1；版本、任务协议、公开 API 与处理算法保持不变。

## 文件职责

- `services/pdf.service.ts` 保留全部 13 个公开方法、选项与帮助函数导出，继续支持
  `new PdfService()`；内部使用组合，无新增 Nest provider。
- `services/pdf/options.type.ts` 集中选项；`page-operations.ts`
  负责合并、拆分、页数、旋转、重排；`content-operations.ts`
  负责图片、文字水印与元数据；`security-operations.ts` 负责加密和压缩；`text-extractor.ts`
  负责文本抽取；`mupdf-runtime.ts` 统一动态加载。
- `markdown-document.ts`、`docx-text.ts` 处理输入文档；`libreoffice-converter.ts`
  管理外部转换；`document-pdf-converter.ts`
  编排滤镜重试、校验、回退与临时目录清理；`markdown-pdf-normalizer.ts` 与
  `document-fallback-renderer.ts` 分别负责输出校验及本地渲染。
- `processors/pdf.processor.ts` 保留队列装饰器、构造参数顺序、重试判定及 failed/stalled 生命周期。
- `processors/pdf/dispatch.ts` 按任务类型委派 13 个有类型的 Handler；`task.type.ts`
  关联任务与配置；`task-context.ts` 统一读取 PDF、双通道进度、上传及完成顺序；`zip-output.ts`
  管理 ZIP 产物。

## 测试与验证

- 修改前基线：service / processor 两文件，47 pass、0 fail、182 次断言。
- 定向覆盖运行：`bun test --coverage ./test/modules/tasks/services/pdf.service.test.ts ./test/modules/tasks/processors/pdf.processor.spec.ts ./test/modules/tasks/services/pdf/`，65
  pass、0 fail、256 次断言。日志：`log/pdf-refactor-coverage.log`。
- 额外复跑旧共享 Processor 测试：PDF 三文件加 `image.processor.spec.ts`，67 pass、0
  fail、272 次断言。日志：`log/pdf-refactor-tests.log`。
- 新增行为验证：零基 inclusive
  ranges、重排/复制/删页、全部操作分发及真实输出、指定合并/提取顺序、ZIP 解包后的条目内容、图片尺寸、滤镜尝试顺序、回退错误和临时目录清理、两种进度渠道、上传失败重试、真实用户套餐/角色传递。
- PDF 源码和三个测试范围运行 ESLint，`--max-warnings 0`，退出码 0；API `bun run build` 退出码 0。
- 覆盖率中的 PDF 门面、文档转换编排及任务上下文均为 100% 行覆盖；部分既有算法分支尚未全部覆盖。
- 自审逐项比对所有提取方法和文档编排，规范化空白及委派名称后与 HEAD 一致；复核完成/进度、ZIP 文件名、错误分类、CAD 校验顺序与构造兼容。`git diff --check`
  退出码 0。

## 限制与交接

- 实际 LibreOffice 成功导出依赖宿主机安装；本轮使用转换边界替身验证成功输出、重试和清理，使用缺失命令验证真实本地回退。没有改变已有转换/回退限制。
- 额外运行包含全部测试的 `bunx tsc --noEmit -p tsconfig.json`
  返回 2，存在 165 条诊断；PDF 生产模块及其测试无诊断，其余涉及证件照、图像生成、控制器等其它测试。完整输出在
  `log/pdf-refactor-typecheck.log`，未扩展修改范围处理。
- 共享 `image.processor.spec.ts`
  仅移除了 PDF 源码字符串断言，PDF 归属契约由实际 Processor 上传行为验证；其它 Processor 原断言保留。
- 集成阶段全 API 测试为 851 通过、2 个 Windows 符号链接测试跳过、0 失败；OpenAPI/client 重复生成无漂移。此次 OpenAPI 唯一变化为图库
  `tags` 的已有一维数组契约纠正，与 PDF 无关。最终 Git 提交由主执行者统一创建。
