# AI 生图设计

- 日期：2026-08-22
- 新增页面：`apps/web/src/app/[locale]/(app)/image/generate/page.tsx`
- 新增任务类型：`image_generate`
- 关联设计：[2026-07-07-id-photo-generator-design](./2026-07-07-id-photo-generator-design.md)、[2026-08-18-id-photo-local-segmentation-design](./2026-08-18-id-photo-local-segmentation-design.md)

## 背景

平台当前 17 个任务类型全部是「对已有文件做变换」。AI 生图是第一个「从提示词产出新文件」的能力，也是第一个成本直接与外部 API 计费挂钩的功能。

现有可复用的基础设施已经相当完整：

- **登录门禁现成**。`POST /tasks` 本身是 `@Public()`（`apps/api/src/modules/tasks/tasks.controller.ts:38`），真正的门禁在 `TasksService.assertCanCreateTask`（`tasks.service.ts:263-283`）——它对 `isServerTask(type)` 为真的类型检查 `canUseFeature(user, 'task.serverProcessing')`，而该 feature 的最低档位是 `signed_in`（`packages/utils/src/entitlements.ts:52`）。把新类型放进 `isServerTask` 的 server 分支（`tasks.service.ts:285-307`），「必须登录」自动生效，controller 与 guard 无需改动。
- **OpenAI 兼容调用已有先例**。`apps/api/src/modules/tasks/services/portrait-segmentation.service.ts` 已实现 baseUrl 归一化（`:136-156`）、`fetch` 注入（`:230-239`）、上游报错解析（`:381-393`），其中 `bufferFromGeneratedImagePayload`（`:199-220`）已能解析 `b64_json` / `base64` / `image` / `image_base64` / `url` 五种响应形态。
- **产物落库链路可原样照抄**。`image.processor.ts` 的 `handleIdPhoto`（`:231-273`）展示了完整五步：`filesService.getById` → `download` → `getTaskOutputOwner(task.userId)` → `filesService.upload` → `tasksService.markCompleted`。
- **前端工具页组件齐备**。`ToolPageShell` / `ToolStepRail` / `FileDropzone` / `ProcessingProgress` / `ResultPanel` / `FailureRecoveryPanel` 均在 `apps/web/src/components/tools/` 下；轮询有 `useTaskProgress`（`apps/web/src/hooks/api/use-task-progress.ts:8`）。

调研中推翻的两个前期假设，记录在此以免后续重复踩：

1. **`inputFileIds` 空数组现在就能通过，无需任何改造。** `createTaskSchema` 的 `.min(1)`（`packages/validators/src/tasks.ts:25`）从未被 `.parse()` 调用过，全仓只使用它推导出的 `CreateTaskInput` 类型。HTTP 边界实际生效的是 class-validator DTO，那里只有 `@IsArray()` + `@IsUUID('4', { each: true })`，没有 `@ArrayMinSize`（`tasks.dto.ts:52-55`）。`assertCanAccessInputFiles` 遍历的是 `Set`（`tasks.service.ts:230`、`:249`），空集合是 no-op。
2. **prompt 不会被匿名读取。** `GET /tasks/:id` 没有 `@Public()`（`tasks.controller.ts:59`），全局 `AuthGuard` 会拒绝未登录请求，他人任务返回 403（`tasks.service.ts:128`）。`inputConfig` 不在 `/tasks/:id/status` 的返回字段内（`tasks.controller.ts:81-87`）。产物文件同理受保护：`files.service.ts:241` 使用严格判断 `file.userId && (!userId || file.userId !== userId)`，有主文件的匿名下载会被拒。

真正残留的信息泄露口子只有一处：`GET /tasks/:id/status` 是 `@Public()` 且返回 `errorMessage`（`tasks.controller.ts:74-87`），而现有 provider 的做法是把上游报错原文拼进异常（`portrait-segmentation.service.ts:381-393`）。图像 provider 拒绝违规 prompt 时常在报错中回显原 prompt，因此本设计对生图任务的失败文案另作约定。

## 目标

- 新增 `/image/generate` 页面与 `image_generate` 任务类型，支持文生图、图生图、局部重绘三种模式。
- 必须登录才能使用，通过复用 `isServerTask` + `task.serverProcessing` entitlement 实现，不新增门禁机制。
- 引入每日生成张数配额，不新建数据表。
- 生图任务与现有 CPU 密集型图像任务在队列层隔离。
- provider 层与证件照 AI 抠图配置解耦，各自可独立更换供应商。
- 最大化复用现有 tasks / files / queue / 前端组件，新增代码集中在 provider 调用与三个前端部件。

## 非目标

- 不做 negative prompt 与 seed 复现。OpenAI images 协议无此参数，软实现（拼进 prompt 文本）效果不可控。
- 不改动 `tasks` 表的单 `outputFileId` 结构（`packages/db/src/schema/tasks.ts:49`）。
- 不做本地推理路。扩散模型体积与 `/image/cutout` 的 RMBG 不在一个量级。
- 不改动 `/tasks/:id/status` 的公开性与返回结构，与 `CLAUDE.md` 既有边界一致。
- 不做付费、按量计费与成本报表。
- 不做 provider 可插拔抽象。只有一个实现时接口容易设计偏，等第二个供应商出现再抽。

## 约束

- **协议**：OpenAI 兼容 images 接口。原生参数只有 `prompt` / `size` / `quality` / `n` / `response_format` / `background`，无 `negative_prompt`、无 `seed`、无 CFG/steps。局部重绘依赖 `/v1/images/edits` 的 `mask` 参数，选型时必须确认供应商支持。
- **配置隔离**：新增独立 env 前缀 `AI_IMAGE_*`，不复用 `ID_PHOTO_AI_SEGMENTATION_*`。后者语义是抠图 mask，两者供应商与模型档位诉求不同。
- **单产物模型**：一个任务产出一张图。多张由前端拆成多个任务表达。
- **并发安全**：配额判定必须防止同一用户并发建任务时超发。
- **失败文案**：provider 报错原文只进日志，不进 `errorMessage`。
- **文案**：`apps/web/messages/zh.json` 与 `en.json` 必须成对维护（`AGENTS.md`）。

## 方案

单个任务类型 `image_generate`，三种模式放在 `inputConfig.mode`，而非拆成三个任务类型。

拆三个类型的代价是：任务类型清单 5 处、穷尽 switch 4 处、migration 枚举值全部 ×3，配额判定要分三处累加。收益仅是任务列表页能显示不同标签——而这个通过读 `inputConfig.mode` 渲染副标题即可达成。按「最大化复用、减少维护成本」的既定取向，选单类型。

## 设计

### 数据模型

`inputFileIds` 按模式约定，无需改动任何校验层：

| mode | inputFileIds | 说明 |
| --- | --- | --- |
| `text_to_image` | `[]` | 打 `/v1/images/generations` |
| `image_to_image` | `[源图 id]` | 打 `/v1/images/edits` |
| `inpaint` | `[源图 id, 蒙版 id]` | 打 `/v1/images/edits`，蒙版走 `mask` 参数 |

`inputConfig` 的 zod schema 新建 `packages/validators/src/image-generate.ts`，字段：

- `mode`：三值枚举
- `prompt`：`z.string().min(1).max(2000)`
- `size`：`'1024x1024' | '1024x1536' | '1536x1024'`（对应 1:1 / 2:3 / 3:2）
- `quality`：`'standard' | 'high'`
- `style`：可选预设 key，本质是拼在 prompt 前的模板前缀

不存 `n`。校验时机沿用项目既有约定：schema 在 processor 内 `parse`，与 `IdPhotoService.render` 首行 `idPhotoTaskConfigSchema.parse(rawConfig)`（`id-photo.service.ts:416`）一致，不在 DTO 层做 per-type 分派。

schema 内用 `superRefine` 断言 `inputFileIds` 数量与 mode 匹配（0 / 1 / 2），把模式契约收在一处。

### 每日配额

在 `TasksService.createTask`（`tasks.service.ts:79-110`）的 `assertCanAccessInputFiles` 之后插入一次 COUNT：

```sql
SELECT count(*) FROM tasks
WHERE user_id = $1
  AND type = 'image_generate'
  AND status <> 'failed'
  AND created_at >= date_trunc('day', now())
```

命中现有 `tasks_user_created_idx` 索引 `(user_id, created_at)`（`packages/db/src/schema/tasks.ts:58`）。不新建表、不新建 service。

并发超发无需额外处理：`create` 对登录用户走 `withActiveUserTransaction`（`tasks.service.ts:66`），该函数已对 user 行执行 `SELECT ... FOR UPDATE`（`apps/api/src/common/database/active-user-transaction.ts:45-50`），同一用户的建任务请求天然串行。前端一次提交 N 张会发 N 个并发 `POST /tasks`，它们在这把行锁上排队，每次 COUNT 都读到已提交的最新值。

配额值写进 `packages/utils/src/entitlements.ts` 的 `LIMITS`，新增 `LimitKey`（如 `aiImage.dailyCount`），与现有体积/张数/像素类上限并列。`signed_in` 给保守值；`free` 档因功能本身要求登录而永远读不到，按结构补齐即可。

一次提交 N 张时的部分超额行为：N 个 `POST /tasks` 逐个经过配额判定，超出的那几个返回 403 + `AI_IMAGE_DAILY_LIMIT_EXCEEDED`。前端把成功建出的任务正常展示，被拒的位置显示「今日额度已用完」，不整批回滚。不预先查询剩余额度，也不新增查询额度的接口。

`status <> 'failed'` 的取舍：provider 报错不扣用户额度。这留下了「刷失败任务」的空子，由现有全局 throttler（登录 60 次/分，`apps/api/src/config/throttle.config.ts:8-17`）兜底。

超额时抛 `ForbiddenException`，error code 用专用的 `AI_IMAGE_DAILY_LIMIT_EXCEEDED`，前端据此显示「今日额度已用完」而非通用限流文案。

### 队列隔离

新建 `ai-queue`，`concurrency` 给 8，`lockDuration` 给 10 分钟。

现有 `image-queue` 是 `concurrency: 2`（`image.processor.ts:45-48`），为 sharp / ONNX 的 CPU 密集型负载调校。生图是远程 HTTP 等待型负载，混在同一队列会互相饿死：两个慢生图任务就能堵死全部图片压缩。

改动点：

- `apps/api/src/config/bull.config.ts` 注册队列
- `apps/api/src/modules/tasks/tasks.module.ts` `registerQueue`
- `TasksService` 构造注入（`tasks.service.ts:41-48`）与 `getQueue`（`:309-318`）
- `getTaskQueueName`（`apps/api/src/modules/tasks/task-queue.ts:5-28`）新增 `'ai-queue'` 联合成员与分支

新建 `apps/api/src/modules/tasks/processors/ai-image.processor.ts`，骨架照搬 `image.processor.ts`：按 `task.type` 分派、`reportProgress`（`:101-106`）、catch 内 `markFailed`、`@OnWorkerEvent('failed')` 达到 `maxAttempts` 后兜底 `markFailed`（`:275-290`）。产物落库五步照抄 `handleIdPhoto`（`:231-273`）。

进度节奏：10（校验完成）→ 30（输入文件就绪）→ 80（provider 返回）→ 95（产物上传完）→ 100。

### Provider 层

分两步：先抽公共模块，再建新 service。

**第一步**，新建 `apps/api/src/modules/tasks/services/openai-compatible-image.ts`，把 `portrait-segmentation.service.ts` 中生图确实要用到的 2 个模块级私有函数迁出并导出：

| 函数 | 原位置 | 用途 |
| --- | --- | --- |
| `normalizeOpenAiCompatibleImageEditUrl` | `:147-156` | 归一化到 `/v1/images/edits` |
| `bufferFromGeneratedImagePayload` | `:199-220` | 五种响应形态 → Buffer |

只搬这两个。`normalizeOpenAiCompatibleBaseUrl`（`:136-145`，指向 `/v1/chat/completions`）、`stripJsonFence`、`parseMaskReferenceFromOpenAiContent`、`bufferFromMaskReference` 都只服务于抠图的 `chat_mask` 通道，生图用不到，留在原处不动，避免无关重构。

新增 `normalizeOpenAiCompatibleImageGenerationUrl`，归一化到 `/v1/images/generations`，容忍 baseUrl 已带 `/v1` 或已带全路径、带尾斜杠，行为与既有归一化函数一致。

`portrait-segmentation.service.ts` 改为从新模块 import 这两个函数，行为不变。这一步的回归风险由 `portrait-segmentation.service.spec.ts` 覆盖，必须先跑通再继续。

**第二步**，新建 `apps/api/src/modules/tasks/services/image-generation.service.ts`：

- 三个方法 `generate` / `edit` / `inpaint`，分别打 generations、edits、edits + `mask`
- 构造签名照抄 `OpenAiCompatiblePortraitSegmentationProvider`（`:230-239`）：全部参数带 env 默认值、`fetch: fetchImpl = fetch` 可注入、baseUrl 缺失时构造即抛
- `edit` / `inpaint` 用 `FormData` + `Blob`，形式同 `renderIdPhoto`（`:354-372`）

env（新增至 `.env.example`）：

```env
AI_IMAGE_BASE_URL=
AI_IMAGE_API_KEY=
AI_IMAGE_MODEL=
AI_IMAGE_SIZE=1024x1024
AI_IMAGE_QUALITY=high
AI_IMAGE_RESPONSE_FORMAT=b64_json
```

配额数值不走 env，写在 `packages/utils/src/entitlements.ts` 的 `LIMITS` 里，理由见「每日配额」一节——它是按 plan 分档的能力上限，与现有体积/张数/像素类上限同源。

未配置 `AI_IMAGE_BASE_URL` 时，service 不实例化，`/image/generate` 页面入口隐藏（沿用 `@Optional()` 注入 + env 判定模式，见 `portrait-segmentation.service.ts:409-415`）。

### 错误处理

新增 error code（`apps/api/src/common/errors/error-codes.ts`）：

- `AI_IMAGE_NOT_CONFIGURED`：provider 未配置
- `AI_IMAGE_GENERATION_FAILED`：provider 调用失败
- `AI_IMAGE_CONTENT_REJECTED`：provider 判定 prompt 违规
- `AI_IMAGE_DAILY_LIMIT_EXCEEDED`：超出每日配额

与现有 provider 相反的一条约定：**上游报错原文只 `logger.warn`，不进 `errorMessage`**。`markFailed` 只写 code 与固定文案。原因见「背景」末段——`/tasks/:id/status` 公开返回 `errorMessage`，而图像 provider 拒绝违规 prompt 时常回显原 prompt。

`ai-image.processor.ts` 的 catch 需识别自定义错误类的 `code` 并透出，形式同 `image.processor.ts:85-86` 对 `IdPhotoError` 的特判。

### 前端

新建目录 `apps/web/src/app/[locale]/(app)/image/generate/`，含 `page.tsx`、`layout.tsx`（3 行，`createToolMetadataGenerator('/image/generate')`）、`__tests__/page.test.tsx`。

直接复用，无改造：

- `ToolPageShell`，`requiresLogin: true` 会让 `ToolTrustStrip` 自动渲染「需要登录」徽标
- `ToolStepRail`、`ProcessingProgress`、`ResultPanel`、`FailureRecoveryPanel`
- `FileDropzone`（仅图生图 / 局部重绘使用）
- `useUploadFile`、`useCreateTask`、`useObjectUrl`
- `/login?next=` 重定向 4 行，照 `image/id-photo/page.tsx:135-138`

需要新写的只有三样：

1. **`useTaskGroupProgress(taskIds: string[])`**，新建 `apps/web/src/hooks/api/use-task-group-progress.ts`。现有 `useTaskProgress` 只接单个 taskId（`use-task-progress.ts:8`），而 React Hook 不能按可变长度循环调用，因此需要在单个 interval 内轮询多个 `/tasks/:id/status`，返回逐项状态数组与聚合完成/失败计数。语义沿用现有 hook：默认 1000ms、全部进入终态后停止、回调只触发一次。
2. **prompt 与参数表单组件**，`apps/web/src/components/tools/image-generate-options.tsx`。prompt textarea、尺寸三选、质量二选、风格预设 4-6 个按钮、张数选择（1/2/4）。
3. **蒙版画笔组件**（仅局部重绘），`apps/web/src/components/tools/mask-brush-field.tsx`。参考 `/image/mosaic` 的 canvas 逻辑，画笔涂抹出重绘区域，导出 PNG（透明=保留原图，不透明=重绘），再经 `useUploadFile` 作为第二个输入文件上传。

提交流程：上传所需输入文件（0/1/2 个）→ 按张数并发 `createTask` N 次 → 收集 N 个 taskId 交给 `useTaskGroupProgress` → 逐张完成即逐张展示，不等全部完成。

输入文件只上传一次，N 个任务共用同一组 `inputFileIds`。图生图选 4 张不应产生 4 次上传。

### 生成内容标识

产物上传前用 sharp 写入 XMP/EXIF 隐式标识（生成工具、模型、生成时间），成本极低。不加显式可见水印。

依据《生成式人工智能服务管理暂行办法》与《AI 生成合成内容标识办法》，在中国大陆对公网提供生成合成内容需要服务备案与内容标识。本项目当前定位是「免费受限公测、IP + HTTP、非正式生产版」（`CLAUDE.md`），但生图产出的是生成合成内容，性质与纯文件处理不同。本设计取「隐式标识做掉、显式水印与备案留待正式生产前处理」的折中，并在下方前置决策中标注为可推翻项。

### 实施顺序

按 文生图 → 图生图 → 局部重绘 推进。

蒙版画笔是整个方案里唯一没有现成参照的部件，也是风险最高的一块。前两个模式跑通即构成可用里程碑，即使局部重绘延后也不影响交付。

## 测试计划

新增测试：

- `openai-compatible-image.test.ts`：两个 URL 归一化函数（edits 与 generations）的边界（裸域名、带 `/v1`、带全路径、带尾斜杠）；`bufferFromGeneratedImagePayload` 五种响应形态。
- `image-generation.service.spec.ts`：注入 fake `fetch`，覆盖三个方法的请求构造（generations 无文件、edits 带 image、inpaint 带 image + mask）；**断言上游报错原文不出现在抛出的 `message` 中**。
- 配额测试（并入 `tasks.service.test.ts`）：第 N 次通过、第 N+1 次抛 Forbidden；`failed` 状态的任务不计入；跨天边界重置。
- `ai-image.processor.spec.ts`：三个 mode 分派到对应 service 方法，形式照 `image.processor.spec.ts:17-31`。
- `use-task-group-progress.test.ts`：多 id 轮询、部分完成、全部终态后停止、回调只触发一次。
- `image/generate/__tests__/page.test.tsx`：未登录点击生成跳登录；三个模式的表单切换；N 张并发建任务。
- **zh/en 文案 key parity 测试**（新增，全仓当前缺失）：递归比对 `zh.json` 与 `en.json` 的 key 集合。调研确认全仓没有任何 `Object.keys` 比对，中英文漏 key 不会被任何测试抓到。

必然失败、需一并修改的既有测试：

| 测试 | 位置 | 原因 |
| --- | --- | --- |
| `tool-metadata.test.ts` | `:46` | `toHaveLength(11)` 硬编码图片工具数量 |
| `tool-experience.test.tsx` | `:71-77` | `count: 11` 隐含推荐工具数量 |
| `task-queue.test.ts` | 全文 | 逐条列举 type → queue，需加 `image_generate` → `ai-queue` |
| `tasks.dto.test.ts` | `:21-37` | 用 `readFileSync` 读源码断言 type 字符串存在，照格式加一条 |
| `task-category.test.ts` | 全文 | type → category 映射 |
| `sitemap.test.ts` | 全文 | sitemap 由 `allTools` 驱动 |
| `tool-route-metadata.test.ts` | `:45-57` | 遍历 `allTools` 校验 titleKey/descriptionKey 引用链 |

编译期即会失败（穷尽 switch 与 Record，视为强制清单）：`task-queue.ts:5`、`tasks.service.ts:285` `isServerTask`、`tasks.service.ts:309` `getQueue`、`apps/web/src/lib/tasks/task-category.ts:5`、`apps/web/src/app/[locale]/(app)/tasks/page.tsx:100-118` 的 `Record<TaskType, string>`。

发布前跑 `bun run release:verify`（10 步，含 OpenAPI 与 client 漂移检查）。

## 影响范围

任务类型清单 5 处必须同步：

1. `packages/db/src/schema/tasks.ts:13` `taskTypeEnum` pgEnum，随后 `cd packages/db && bunx drizzle-kit generate`（新迁移 0015，内容为一行 `ALTER TYPE "public"."task_type" ADD VALUE 'image_generate';`，参照 `packages/db/drizzle/0006_image_id_photo.sql`）
2. `packages/validators/src/tasks.ts:3` zod `taskTypeEnum`
3. `apps/api/src/modules/tasks/dto/tasks.dto.ts:23` `TASK_TYPES`
4. `apps/web/src/hooks/api/types.ts:1-18` `TaskTypeValue` 手写联合类型
5. `packages/api-client/src/schema.ts` 生成物——改完前三处后跑 `cd apps/api && bun run openapi:export`，再 `cd packages/api-client && bun run generate`

前端元数据与文案：

- `apps/web/src/lib/tools/tool-metadata.ts` `imageTools` 追加条目（`processing: 'server'`、`requiresLogin: true`、新 `categoryKey`），并在文件头 lucide import 中加图标
- `apps/web/messages/zh.json` 与 `en.json`：`ToolCatalog.categories.<新分类>` 与 `<新分类>Description` 成对（`groupByCategory` 硬依赖此命名约定，`tool-metadata.ts:378-387`）、`ToolCatalog.tools.imageGenerate`、`TasksTool.typeImageGenerate`、页面自有顶层命名空间 `ImageGenerate`

文档：

- `CLAUDE.md`：前端路由列表、工具处理边界、任务类型全列表、env 段
- `PROJECT_SPECS.md`：任务类型全列表
- `README.md`：工具列表、AI 配置说明章节
- `.env.example`：新增 `AI_IMAGE_*` 段
- **`docker-compose.prod.yml` api service 的 environment**：当前连 `ID_PHOTO_AI_*` 都未透传，新增 `AI_IMAGE_*` 必须显式加入，否则本地可用而生产静默降级为「未配置」

## 实施前置决策

1. **provider 选型待定**。必须选一个同时支持 `/v1/images/generations` 与 `/v1/images/edits` 带 `mask` 的 OpenAI 兼容供应商，否则局部重绘无法实现。开工前需实测确认 `mask` 参数生效。
2. **每日配额具体数值待定**。设计取 `signed_in` 10 张/天作为占位，实际值取决于所选 provider 单价。
3. **生成内容标识范围**。本设计取「隐式 XMP 标识做掉、显式水印不做」，此项可推翻；若判定需合规发布，还需处理服务备案与显式标识，属本设计范围外。
4. **风格预设的具体文案**。4-6 个预设的 prompt 模板前缀需实测调优，实施时定稿。
