# Complete Key Design Principles Page Optimization Design

## Goal

按 `docs/product-design-architecture-audit.md` 的“关键设计原则”一次性优化 Utils Plane 前端页面体验：工具优先、可信透明、状态可见、流程统一、专业克制。

## Scope

本次覆盖前端页面与共享工具组件：

- 首页：`apps/web/src/app/[locale]/(marketing)/page.tsx`
- 工作台框架：`apps/web/src/app/[locale]/(app)/layout.tsx`
- 导航与 Header：`apps/web/src/components/layout/app-sidebar.tsx`、`apps/web/src/components/layout/app-header.tsx`
- Dashboard：`apps/web/src/app/[locale]/(app)/dashboard/page.tsx`
- 工具入口页：`image/page.tsx`、`pdf/page.tsx`
- 具体工具页：`image/compress`、`image/convert`、`font`、全部 PDF 工具页
- 文件与任务管理：`files/page.tsx`、`files/trash/page.tsx`、`tasks/page.tsx`
- 共享工具组件：上传、文件列表、处理进度、下载、PDF 预览/页面卡片、排序文件列表、图片选项、字体预览
- 多语言文案：`apps/web/messages/zh.json`、`apps/web/messages/en.json`

本次不改后端权限、任务 token、清理任务、OpenAPI 生成链路；相关风险通过 UI 透明说明和恢复路径表达。

## Design Principles Applied

### 工具优先

首页首屏直接呈现可用工具入口，降低营销叙事权重。主 CTA 指向真实工具，不再指向当前不存在的 `/docs`。工具入口使用清晰分组和高频动作优先级，让用户一眼进入“压缩图片、合并 PDF、转换字体”等真实工作。

### 可信透明

页面统一展示处理位置、文件保留时间、登录要求和失败恢复方式。文案区分“本地处理”和“服务端处理”，不再泛化承诺所有文件都只在浏览器中处理。

### 状态可见

上传、等待、处理中、生成结果、失败、重试都使用稳定的视觉结构：阶段标签、细线进度、结果面板、失败原因和下一步按钮。错误信息转译为用户语言，保留技术码作为辅助信息。

### 流程统一

图片、PDF、字体工具共享同一套页面骨架：页面标题、Trust Strip、上传区、文件/预览区、配置区、处理进度、结果区、历史提示。各工具保留自己的配置差异，但不再各自发明流程。

### 专业克制

继续使用现有设计系统：1px 边框、低阴影、矩阵绿强调、mono 信息层级、紧凑数据密度。减少首页过度装饰和宣传模块，避免伪数据、夸张渐变、emoji、重阴影和超大圆角。

## Architecture

### Shared UI Units

新增或整理共享组件，降低工具页重复：

- `ToolPageShell`：统一标题、说明、信任信息、主内容网格和辅助区。
- `ToolTrustStrip`：展示处理位置、文件保留、登录要求、失败恢复。
- `ToolStepRail`：展示上传、配置、处理、结果四阶段。
- `ResultPanel`：统一成功结果、下载、文件大小变化、后续管理入口。
- `FailureRecoveryPanel`：统一失败原因、重试、更换文件、查看任务记录。
- `PageSectionHeader`：统一 Dashboard、文件、任务和工具入口分区标题。
- `ToolCatalogGrid`：支持工具分组、推荐工具、高频工具和能力标签。

现有 `FileDropzone`、`ProcessingProgress`、`FileList`、`DownloadButton` 会被增强而不是重写，保持调用方式兼容。

### Page Layout

工作台页面最大宽度统一到 `max-w-6xl` 或 `container-main`，工具详情页使用双栏布局：

- 左侧主工作流：上传、预览、配置、进度、结果。
- 右侧辅助信息：Trust Strip、处理步骤、最近任务/历史提示。
- 移动端改为单列，辅助信息下移，不使用拥挤表格。

工具入口页使用分组网格：

- PDF：整理、转换、安全、优化。
- Image：压缩、转换、批量处理、预览对比。
- Font：转换、预览、子集化、服务端处理说明。

### Data Flow

不引入新的后端数据依赖。Dashboard 使用已有 `useFiles`、`useTasks` hook 展示最近文件、最近任务、失败任务和空状态。没有真实聚合 API 的存储用量、成功率等指标不显示伪数字，改为“需要后端汇总接口”的明确空态。

工具详情页保持现有处理逻辑。共享 UI 从页面现有状态推导阶段：

- 无文件：上传阶段。
- 有文件未处理：配置阶段。
- `processing` 或任务进度存在：处理阶段。
- 有结果文件：结果阶段。
- 有错误：失败恢复阶段。

### Error Handling

上传拒绝错误统一转为产品文案：

- 文件过大：显示最大大小和当前文件大小。
- 格式不支持：显示支持格式。
- 单/多文件限制：说明当前工具允许数量。

服务端任务失败显示三层信息：

- 用户可读原因。
- 推荐动作：重试、更换文件、查看任务记录。
- 技术信息：错误码和任务 ID，以 mono 小字显示。

### Accessibility

所有图标按钮补充 `aria-label` 或可见文本。可点击卡片与内部 checkbox 分离事件语义。任务状态和处理进度使用文本标签，不只依赖颜色。文件与任务列表在移动端提供卡片流，避免横向挤压。

### Internationalization

中文和英文文案同时维护。新增文案归入这些 namespace：

- `Marketing`
- `Dashboard`
- `ToolCatalog`
- `ToolShell`
- `ToolsShared`
- `FilesTool`
- `TasksTool`

中文文案必须是 UTF-8、JSON 合法、页面真实渲染无乱码。

## Testing And Verification

新增测试优先覆盖共享行为：

- `ToolTrustStrip` 正确渲染本地/服务端/登录/保留时间。
- `ProcessingProgress` 显示阶段和百分比。
- `FileDropzone` 显示格式、大小、处理位置，并把拒绝错误转为产品文案。
- `ToolCatalogGrid` 正确渲染分组与推荐工具链接。
- Dashboard 在空数据下不显示伪造统计。

执行验证：

- `bun --cwd apps/web test`
- `bun --cwd apps/web build`
- 页面人工检查：首页、Dashboard、PDF 入口、图片入口、字体页、至少 3 个 PDF 详情页、文件页、任务页。
- 暗色/亮色主题各检查一次移动端和桌面端，确认无文字溢出、无遮挡、无控制台错误。

## Out Of Scope

- 后端权限校验、匿名 signed token、任务状态 token。
- 清理任务实现。
- 新增 dashboard 聚合 API。
- OpenAPI 生成 CI。
- 上传/处理算法本身。

## Acceptance Criteria

- 首页首屏能直接进入真实工具，且没有指向不存在页面的 CTA。
- 侧边栏包含 Dashboard，工作台路径完整。
- Dashboard 不再展示写死为 0 的统计卡，改为最近任务、最近文件、失败恢复、快捷工具和真实空态。
- 所有工具详情页有统一的 Trust Strip、阶段反馈、结果/失败恢复结构。
- PDF 和 Image 入口按任务意图分组，不再平铺所有工具。
- 文件页图标按钮有明确 aria label，批量操作稳定展示。
- 任务详情不再只展示 JSON，包含输入、输出、参数摘要、失败原因和建议动作。
- 上传组件固定显示支持格式、最大大小、处理位置。
- 文案明确区分本地处理和服务端处理。
- 设计保持现有专业克制风格，无伪数据、无 emoji 装饰、无夸张渐变和重阴影。
