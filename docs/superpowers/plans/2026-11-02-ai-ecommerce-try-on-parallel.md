# AI 电商试衣多 Agent 并行执行拆分

> **For agentic workers:** 本文是 `2026-11-02-ai-ecommerce-try-on.md`
> 的并行执行补充，执行前同时阅读设计文档。每个工作包在独立分支/worktree 开发；禁止跨工作包修改他人负责文件。

**目标：**
将试衣模块拆为三个互不覆盖的工作包，分别交给 Codex、Claude、Gemini 并行实现，再由主负责人统一合并、生成数据库迁移和 OpenAPI/client。

**设计依据：** `docs/superpowers/specs/2026-11-02-ai-ecommerce-try-on-design.md`

**原始计划：** `docs/superpowers/plans/2026-11-02-ai-ecommerce-try-on.md`

## 所有 Agent 共用的产品边界

- 新增独立任务类型 `image_try_on`；在任务历史中可单独识别，归入图像类别。
- 普通 `image_generate` 与 `image_try_on`
  共用现有每日生图总额度；额度响应格式不变，失败任务仍按现有策略不计入使用量。
- 继续调用现有 `ImageGenerationService`、`ai-queue`、任务与文件存储，不接入专用 VTON 模型。
- 试衣有 `product`（真实商品试穿）和
  `inspiration`（穿搭灵感）两种模式。产品模式的商品上传图是服装目标；灵感模式的图库服饰是服装目标。
- 结果需要区分真实商品试穿图和灵感图，并标明 AI 生成；不承诺通用生图模型准确还原商品细节。
- 未核实可商用/再分发许可的图不能随项目分发或被 seed；不得因为代码开源就推定图库图片开放。
- 用户上传图片必须走现有用户文件归属校验；任何客户端请求都不接受存储 URL、bucket 名或 storage key。

## 冻结的任务请求契约

`CreateTaskDto` 外层仍使用项目现有结构：

```ts
{
  type: 'image_try_on',
  inputFileIds: string[],
  inputConfig: {
    mode: 'product' | 'inspiration',
    references: Array<
      | { role: 'person'; source: 'upload'; inputIndex: number }
      | { role: 'person'; source: 'library'; assetId: string }
      | { role: 'garment'; source: 'upload'; inputIndex: number }
      | { role: 'garment'; source: 'library'; assetId: string }
      | { role: 'pose'; source: 'library'; assetId: string }
      | { role: 'style'; source: 'library'; assetId: string }
    >,
    promptAddition?: string,
    size?: string,
    quality?: 'auto' | 'standard' | 'high',
    model?: string
  }
}
```

契约校验与处理约束：

- `inputFileIds` 仅包含用户上传文件 ID。`inputIndex`
  是对应上传 ID 在该数组中的 0-based 索引；数组内 ID 不重复，索引必须有效且不能被多个 reference 重用。
- 每个 `inputFileIds` 项必须且只可被一个 upload binding 引用，不允许遗留未绑定上传文件。图库
  `assetId` 使用 UUID。
- 图库图只传 `assetId`，不可传 URL/key。服务端根据 ID 加载当前启用且许可审查通过的图库素材。
- 每个 role 最多出现一次；必须恰有一个 `person` 和一个 `garment`，总参考数为 2–4。
- `product` 模式要求 `garment.source === 'upload'`；`inspiration` 模式要求
  `garment.source === 'library'`。
- `pose`/`style` 仅允许图库来源；其中 `style` 关联图库 `kind='garment'`，只作为弱优先级辅助参考。
- `person` 支持上传或 `kind='person'` 的图库资产。姿势图库资产为 `kind='pose'`。
- 服务端解析后按固定顺序传给生图服务：`person`、`garment`、`pose`、`style`。商品款式/颜色/纹理以目标 garment 为准，style 不得覆盖商品目标。
- 试衣使用生图图生图模式；服务端组装固定角色提示词，`promptAddition`
  只能补充场景/背景等描述，不能替换角色优先级。映射为现有生图服务配置时使用
  `mode: 'image_to_image'`。
- `size`、`quality`、`model` 采用现有生图约束和默认值；不要重复实现供应商/模型校验。
- `promptAddition` 使用现有生图提示词最大长度上限；`size`、`quality`、`model`
  的格式/长度校验复用现有 schema。

## Agent 工作包

### Agent A：任务核心、生成处理与共享额度

**建议分配：Codex**

**目标：** 让后端能创建、校验、排队和执行 `image_try_on`，并与普通生图共用额度。

**独占负责文件：**

- `packages/validators/src/tasks.ts`
- `packages/validators/src/image-try-on.ts`（新建）
- `packages/validators/src/index.ts`
- `packages/db/src/schema/tasks.ts`
- `apps/api/src/modules/tasks/dto/tasks.dto.ts`
- `apps/api/src/modules/tasks/task-queue.ts`
- `apps/api/src/modules/tasks/tasks.service.ts`
- `apps/api/src/modules/tasks/daily-task-quota.ts`
- `apps/api/src/modules/tasks/processors/ai-image.processor.ts`
- `apps/api/src/modules/tasks/services/ai-try-on-reference-image-source.ts`（新建，图库端口 token 与接口）
- 对应 validators/API tests 中仅覆盖上述功能的测试

**实现要求：**

- 在共享 Zod validators 中实现并导出
  `imageTryOnTaskConfigSchema`，严格校验本文件规定的契约、角色/来源组合、索引边界、去重和数量限制。
- 注册任务类型并映射到
  `ai-queue`；TaskService 验证所有 upload 输入归属并对两个生图任务类型合并计算额度。
- Processor 支持 `image_generate` 原行为不变；`image_try_on` 按 reference
  bindings 解析上传图和图库图，调用现有生成服务并沿用进度、失败脱敏、产物标记和输出保存逻辑。
- 图库解析通过 Agent A 定义的 `AI_TRY_ON_REFERENCE_IMAGE_SOURCE` injection token；端口接口为：

```ts
getImageForGeneration(
  assetId: string,
  expectedKind: 'person' | 'pose' | 'garment'
): Promise<Buffer>
```

- `role='style'` 调用上述方法时传
  `expectedKind='garment'`。Asset 未启用、kind 不匹配、许可未审查或不存在均失败关闭，不调用图像供应商。
- Agent B 在 `TasksCoreModule` 将 token 绑定到图库 service（`useExisting`）；Processor 不直接依赖图库实现类。
- 添加测试：无效 binding 拒绝、上传文件用户归属校验、图库 kind 错配拒绝、四图上限、商品图优先级提示词、两任务类型共享额度、失败任务排除、现有
  `image_generate` 回归。

**明确不负责：**
图库 schema/查询 API、Web 页面、数据库 migration 生成、OpenAPI 导出/client 生成、`PROJECT_SPECS.md`。

### Agent B：参考图库 schema 与 API

**建议分配：Claude**

**目标：** 提供人像、姿势、服饰三类经许可审查的图库查询，并为任务 Processor 安全解析图库图。

**独占负责文件：**

- `packages/db/src/schema/ai-try-on-references.ts`（新建）
- `packages/db/src/schema/index.ts`
- `packages/db/src/index.ts`
- `apps/api/src/modules/tasks/services/ai-try-on-references.service.ts`（新建）
- `apps/api/src/modules/tasks/ai-try-on-references.controller.ts`（新建）
- `apps/api/src/modules/tasks/dto/ai-try-on-references.dto.ts`（新建）
- `apps/api/src/modules/tasks/tasks-core.module.ts`
- `apps/api/src/modules/tasks/tasks-api.module.ts`
- 对应 DB/API tests 中仅覆盖图库功能的测试

**数据/API 契约：**

- 表记录至少包含：UUID `id`、`kind`
  (`person|pose|garment`)、双语标题/描述、tags、素材 bucket/storage key、thumbnail bucket/storage
  key、source URL、license name、license URL、attribution、`licenseReviewedAt`、`enabled`
  和排序字段。
- 查询 `GET /tasks/ai-try-on/references?kind=person|pose|garment&lang=zh|en`。返回
  `id`、`kind`、本地化标题/描述、tags、可展示的 thumbnail
  URL、来源、许可名称和 attribution；永不返回 bucket/key。
- 列表仅返回 `enabled=true` 且 source URL、license name、attribution、`licenseReviewedAt`
  齐全的记录。
- 实现 Agent A 消费的
  `getImageForGeneration(assetId, expectedKind): Promise<Buffer>`；重新校验启用状态、许可字段和 kind，然后服务端读取对象存储。`style`
  对应 `garment`。
- 在 `TasksCoreModule` 将 `AI_TRY_ON_REFERENCE_IMAGE_SOURCE` token 通过 `useExisting` 绑定到图库 service。
- API 不要求登录素材检索，但不能泄露对象 key；任务处理解析只在服务端执行。
- 加入带明确 provenance/license 的少量原创或明确授权种子数据；没有可确认的素材时允许空图库，不能用未授权开源仓库图片填充。提供种子脚本或现有 seed 机制接入。
- 添加测试：语言选择、kind 筛选、未启用和许可字段不全时过滤、生成解析时 kind/license 校验、对象读取失败行为。

**明确不负责：** `task_type` 枚举、任务额度、Processor、validators barrel
`packages/validators/src/index.ts`、Web 页面、数据库 migration 生成、OpenAPI/client 导出。

### Agent C：独立 Web 工作台

**建议分配：Gemini**

**目标：** 在 Web 提供独立试衣体验，覆盖真实商品试穿和穿搭灵感两种流程。

**独占负责文件：**

- `apps/web/src/app/[locale]/(app)/image/try-on/`（新建）
- `apps/web/src/components/tools/ai-try-on/`（新建）
- `apps/web/src/hooks/api/` 中试衣专用 hook；如需扩展公共任务类型，仅改该目录内的类型文件
- `apps/web/src/lib/tools/tool-metadata.ts`
- `apps/web/src/lib/tasks/task-category.ts`
- `apps/web/src/app/[locale]/(app)/tasks/page.tsx`
- `apps/web/messages/zh.json`
- `apps/web/messages/en.json`
- 对应 `apps/web/test/` 与 `apps/web/e2e/` 试衣用例

**实现要求：**

- 独立 route `/image/try-on`；用分段控件在 `product` 与 `inspiration` 间切换。
- 支持上传个人照或选 person 图库；product 模式上传商品图；inspiration 模式选 garment 图库；pose 可选，style 只作为可选弱辅助参考。
- 前端按冻结契约生成 `inputFileIds` 和 `inputConfig.references`：上传 ID 去重，`inputIndex`
  对应顺序准确，图库只发 asset UUID，不发 URL/key。
- 最多 4 张参考；缺 person/garment、额度耗尽或必需接口失败时禁用提交并给出可翻译错误状态。图库为空时仍可在 product 模式上传商品图和人像并提交。
- 显示共享额度快照；生成后展现排队/处理中/成功/失败、下载与重新生成；结果标明 AI 生成及模式类型。
- 在任务列表可单独显示“AI 电商试衣”类型，但归在图像类别。
- API hooks 可先按本契约实现；不得修改 API DTO、OpenAPI 或 generated API
  client。若最终 OpenAPI 类型有字段差异，合并负责人统一修正。
- 添加测试：两种模式表单、生成按钮启用条件、inputIndex 映射、四图上限、额度耗尽、图库空状态、上传降级流程、错误/加载/成功状态和双语文案。

**明确不负责：** API、DB
schema/migration、服务端共享额度实现、OpenAPI/client 导出、`PROJECT_SPECS.md`。

## 合并负责人工作包

以下不分给并行 Agent，由主负责人在三个工作包合并后统一完成：

- 审核三个分支的修改和测试输出，解决接口或行为冲突。
- 同时合并 `tasks` 与 `ai_try_on_references` schema 后，在 `packages/db`
  生成 migration，检查迁移顺序和快照；不要让多个并行分支各自生成迁移快照。
- 运行迁移并确认空数据库可完整 migrate；OpenAPI 导出一次并更新 `packages/api-client`。
- 校对 task type 在 API/validators/db/Web 的枚举和标签均一致。
- 更新 `PROJECT_SPECS.md`，跑 validators/API/Web 全量测试、lint/build/format；配置 mock
  provider 的 E2E。
- 在获准素材中做图库审核；真实商品模式先用多类 SKU 做细节还原评估再开放。

## 并行顺序与交接

```text
冻结本文件中的契约
       ├── Agent A：任务核心 + 额度 ───┐
       ├── Agent B：参考图库 API ──────┼── 合并负责人：迁移/OpenAPI/集成验收
       └── Agent C：Web 工作台 ─────────┘
```

- 三个 Agent 从同一个最新基线各自在独立分支/worktree 开始，开始前确认已收到本文件和设计说明。
- Agent A 可以等 Agent
  B 完成 service 签名后继续写 processor；若并行启动，则先用上述签名和 mock 实现，不得自行更改签名。
- Agent
  C 可并行完成页面和组件；API 集成按本文件契约编写，待主负责人合并 API/client 后适配最终生成类型。
- 每个 Agent 只提交自己拥有的文件，不要 cherry-pick 其他 Agent 文件或生成共享 migration/OpenAPI。
- 每个交付包含：改动摘要、提交 SHA、运行过的测试命令及结果、尚未解决的问题。
- 合并负责人按 Agent A → Agent B → Agent
  C 合并或逐项 cherry-pick；再统一生成 migration、OpenAPI/client 并做集成修正。

## 验收门

- Agent A：validators + API 任务处理/额度测试通过；现有 `image_generate` 路径无回归。
- Agent B：图库 service/controller 测试通过；未审查/未启用素材不能出现在列表或被 processor 解析。
- Agent C：Web 试衣测试通过；两个模式能按契约创建任务，共享额度显示正确。
- 集成：fresh DB migration、API build/OpenAPI、Web
  build、完整测试通过；无第三方未授权图片进入仓库或部署素材桶。
