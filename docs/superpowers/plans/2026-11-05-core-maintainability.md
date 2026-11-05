# 核心页面与 PDF 服务维护性优化实施计划

> 执行方式：按独立职责拆分任务；使用现有行为测试保护重构，并在完成后独立审查。

**目标：**
降低试衣工作台、参考图库与 PDF 处理链路的维护成本，保持用户界面、任务协议、输出和错误语义。

**架构：**
页面负责组合视图，专用 Hook 管理表单、上传与任务状态；图库的分组筛选与卡片/弹窗展示分开；PDF 服务保留兼容入口，内部按文档转换、页面操作等职责分模块，Processor 保留队列生命周期并委派具体操作。

**技术栈：**
现有 Next.js/React、next-intl、NestJS、TypeScript、Bun/Vitest；不引入新的框架或运行时依赖。

**依据：** 用户选择上一轮分析中的「P2：降低核心页面和服务的维护成本」并要求先完成。

## 约束与验收关注

- 不调整公开 API、任务类型、存储策略、处理算法、视觉布局或资源上限。
- 现有 `PdfService` 导出、构造与方法调用继续兼容，重构不改变 Nest 注入行为。
- 试衣商品/灵感模式、角色绑定顺序、上传复用、额度刷新、失败重试与预览行为保持一致。
- 图库保留视角分组、性别与服装筛选、搜索、分页、许可和已选素材展示。
- 中文与英文可见文案保持一致；抽取范围内的硬编码双语言文案移入 messages。
- 测试放在与 src 同级的 test 目录；日志放在 log；新增文档放在 docs。
- 本轮依赖版本保持不变，避免将工具链迁移混入行为等价重构。
- 不升级发布版本或写用户更新日志；完成验证后创建中文 Git 提交。

## Task 1：PDF 服务与处理器职责拆分

**文件：**
`apps/api/src/modules/tasks/services/pdf.service.ts`、`processors/pdf.processor.ts`，新增相邻
`services/pdf/`、`processors/pdf/` 模块；测试位于原 test 镜像路径。

- [x] 运行原 PDF service/processor 测试，确认基线。
- [x] 将选项类型、Markdown/HTML 与 DOCX 帮助函数、LibreOffice/文档转换、PDF 页面操作拆成有界模块，兼容旧导出。
- [x] Processor 按操作委派 Handler，集中进度和上传完成逻辑，移除任务参数上的 any。
- [x] 补足能发现拆分回归的行为测试：多份 ZIP、页码/顺序、文档转换失败回退、进度与错误重试。
- [x] 运行定向测试和 API 构建，核对 PDF 的 OpenAPI 未改变。

## Task 2：试衣页面编排与状态拆分

**文件：** `apps/web/src/app/[locale]/(app)/image/try-on/page.tsx`、新建
`components/tools/ai-try-on/` 下专用 Hook 与视图组件、对应页面/Hook 测试。

- [x] 运行原页面测试，覆盖商品/灵感模式、上传与生成流程。
- [x] 提取表单、派生状态、上传复用、提交/重试与额度刷新到专用 Hook；页面仅组合视图。
- [x] 将参数、参考图与结果等展示区域拆成明确组件，避免把整个页面搬成另一个巨型文件。
- [x] 保持已有交互，新增必要的 Hook 或页面行为用例。
- [x] 运行定向测试；汇总需移入 messages 的文案。

## Task 3：参考图库领域逻辑与展示拆分

**文件：**
`apps/web/src/components/tools/ai-try-on/ReferenceLibraryGrid.tsx`、相邻分组筛选模块与卡片/弹窗组件、对应 test。

- [x] 用行为测试固定视角分组、搜索筛选与分页选择的现有结果。
- [x] 抽取纯分组/分类函数，分离卡片和弹窗，公开组件 props 继续兼容。
- [x] 保持许可展示、筛选统计、快速选择和多视角选择。
- [x] 运行定向测试；汇总需移入 messages 的文案。

## Task 4：类型、文案与整体验证

**文件：**
`apps/web/src/hooks/api/use-ai-try-on.ts`、`hooks/api/types.ts`、`apps/web/messages/{zh,en}.json`、`README.md`、`PROJECT_SPECS.md`。

- [x] 使用生成的 API 路径/参数类型，清除试衣图库调用中的 any，保留现有响应兼容行为。
- [x] 同步提取文案的中英文 messages，并更新结构说明。
- [x] 运行 packages/API/Web 全部单元测试、lint、API/Web 构建和 OpenAPI/client 漂移检查。
- [x] 运行试衣 E2E；核对界面与操作未改变。
- [x] 独立审查整个改动，修复实际回归，提交中文 Git 记录。

## 执行记录

- 当前工作区为独立分支 `codex/core-maintainability`，基于 `155bc6a`。
- 各子任务修改互不重叠；messages、共享类型、入口文档与总体验证由主执行者统一处理。
- 类型核对发现 Swagger 同时使用 `type: [String]` 和 `isArray: true`，导致图库 `tags`
  被生成为二维数组。新增 OpenAPI 契约测试先确认失败，再移除重复数组声明并重新生成 client；实际 HTTP 响应保持一维字符串数组不变。
- 共享包基线：262 项测试通过。图库 API Hook 与角色配置相关测试：13 项通过。

## 集成验证结果

| 验证                           | 结果                                                   |
| ------------------------------ | ------------------------------------------------------ |
| `bun run test:packages`        | 262 通过                                               |
| `bun run test:api`             | 851 通过，2 个 Windows 符号链接用例跳过，0 失败        |
| `bun run test:web`             | 118 个文件，799 通过                                   |
| `bunx playwright test`         | 全部 10 项通过，包含中英文试衣与图库选择               |
| `bun run build`                | 全部 9 个构建任务成功，包含 API、API client 和 Web     |
| `bun run lint`                 | 全部 14 个任务成功，无 error；保留仓库其它范围 warning |
| `bun run format:check:changed` | 67 个源码、测试及文档文件通过；生成文件按项目规则排除  |
| OpenAPI / client 重复生成      | 与本次生成结果哈希一致，无漂移                         |

行数按物理行统计：试衣页面 1281 → 42，图库入口 1176 → 308，`PdfService` 1257 → 94， `PdfProcessor`
1035 → 114。被抽取实现按职责独立维护，并未删除相应功能。

旧的两个源码字符串检测要求实现直接出现在入口文件，已移除其中试衣和 PDF 的结构约束，分别以实际页面的结果/失败恢复/重试，以及 Processor 的真实产物与 owner 参数测试保护。

试衣上传接口尚未在 OpenAPI 中声明完整响应，工作台通过 `unknown`
边界检查所需的文件 ID；缺少响应时保留上传失败恢复流程，未通过双重类型断言绕过检查。

额外检查发现全仓含测试/E2E 的直接 `tsc`
仍有其它模块的类型诊断；本次修改范围的源码检查与生产构建通过，不将其表述为全仓所有测试文件的静态类型检查通过。完整发布验证命令未执行，本轮只进行重构验证，不打包或发布。

## 独立审查

独立审查未发现本次改动引入的问题，结论为可提交。审查核对了 PDF 的 40 个原函数/方法体与13 个 Handler 的参数、owner、上传/完成/进度顺序，以及试衣上传缓存、重试、额度刷新和图库方向/筛选/分页行为。试衣与图库的静态
`className`、`data-testid`、`id`、`htmlFor` 与基线比较无差异。

审查确认 PDF 转图片的既有资源释放、图库的既有焦点管理属于后续专项，本轮拆分未改变这些行为。未执行真实 LibreOffice 成功导出或截图像素对比；已有集成用例和 DOM/CSS 核对的边界如上。
