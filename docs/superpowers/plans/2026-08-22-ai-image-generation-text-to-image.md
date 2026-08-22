# AI 生图（文生图）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上线 `/image/generate`
的文生图能力——登录用户输入提示词与参数，服务端经 OpenAI 兼容 provider 生成图片并落库到账号文件，受每日配额约束。

**Architecture:** 新增单个任务类型 `image_generate`（本计划只实现
`inputConfig.mode === 'text_to_image'`），走新的独立 `ai-queue`。provider 调用抽在
`ImageGenerationService`，OpenAI 兼容的 URL 归一化与响应解析抽成共享模块
`openai-compatible-image.ts` 供抠图与生图复用。强制登录复用既有 `isServerTask` +
`task.serverProcessing` entitlement，每日配额直接 COUNT `tasks` 表、依赖 `withActiveUserTransaction`
已有的用户行锁保证并发安全。前端一张图对应一个任务，多张拆成多个并发任务，由新 hook
`useTaskGroupProgress` 聚合轮询。

**Tech Stack:** NestJS 11 + Bun、BullMQ + Redis、Drizzle ORM + PostgreSQL 16、Zod、sharp、Next.js 14
App Router + React 18、TanStack Query、next-intl、bun:test

**设计依据:**
[2026-08-22-ai-image-generation-design](../specs/2026-08-22-ai-image-generation-design.md)

**本计划不含（各自出后续计划）:** 图生图（`image_to_image`）、局部重绘（`inpaint`）、蒙版画笔组件。

---

## 前置条件

开工前必须确认：`AI_IMAGE_BASE_URL` 指向的 provider 实测支持 `POST /v1/images/generations`，且返回
`b64_json`。未确认前 Task 6 之后的任务无法验证。

本地需要跑起依赖服务：

```bash
bun run services:up
```

---

## Task 1: 注册 image_generate 任务类型

新增枚举值需要同步 5 处清单 +
4 处穷尽 switch。穷尽 switch 缺分支会编译失败，是强制清单；5 处清单缺一处会在运行时或类型检查时炸。

**Files:**

- Modify: `packages/db/src/schema/tasks.ts:13-31`
- Modify: `packages/validators/src/tasks.ts:3-21`
- Modify: `apps/api/src/modules/tasks/dto/tasks.dto.ts:23-41`
- Modify: `apps/web/src/hooks/api/types.ts:1-18`
- Modify: `apps/api/src/modules/tasks/task-queue.ts:5-28`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts` (`isServerTask`、`getQueue`)
- Modify: `apps/web/src/lib/tasks/task-category.ts:5-28`
- Modify: `apps/web/src/app/[locale]/(app)/tasks/page.tsx:100-118`
- Test: `apps/api/src/modules/tasks/dto/tasks.dto.test.ts`
- Test: `apps/api/src/modules/tasks/task-queue.test.ts`

- [ ] **Step 1: 写失败测试——DTO 边界包含新类型**

在 `apps/api/src/modules/tasks/dto/tasks.dto.test.ts` 的 `describe('TaskQueryDto', ...)` 内追加：

```ts
it('includes the AI image generation task type in the API boundary', () => {
  const source = readFileSync(join(import.meta.dir, 'tasks.dto.ts'), 'utf8').replace(/\r\n/g, '\n');

  expect(source).toContain("'image_generate'");
});
```

- [ ] **Step 2: 写失败测试——队列路由**

在 `apps/api/src/modules/tasks/task-queue.test.ts` 的 `describe`
内追加一个独立用例（不要塞进现有那条，现有那条断言的是既有家族）：

```ts
it('routes AI image generation to the dedicated ai-queue', () => {
  expect(getTaskQueueName('image_generate')).toBe('ai-queue');
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
bun --cwd apps/api test src/modules/tasks/dto/tasks.dto.test.ts src/modules/tasks/task-queue.test.ts
```

预期：两个新用例 FAIL。`task-queue.test.ts` 还会有 TypeScript 报错，因为 `'image_generate'` 不是
`TaskType` 的成员。

- [ ] **Step 4: 五处类型清单加值**

`packages/db/src/schema/tasks.ts`，在 `taskTypeEnum` 数组末尾（`'pdf_from_document',` 之后）加一行：

```ts
  'image_generate',
```

`packages/validators/src/tasks.ts`，在 `taskTypeEnum` 数组末尾加同一行：

```ts
  'image_generate',
```

`apps/api/src/modules/tasks/dto/tasks.dto.ts`，在 `TASK_TYPES` 数组末尾加同一行：

```ts
  'image_generate',
```

`apps/web/src/hooks/api/types.ts`，在 `TaskTypeValue` 联合末尾加：

```ts
  | 'image_generate';
```

（注意把原来 `| 'pdf_from_document';` 的分号移到新行末尾。）

- [ ] **Step 5: 四处穷尽 switch 加分支**

`apps/api/src/modules/tasks/task-queue.ts`，先扩联合类型再加分支：

```ts
export type TaskQueueName = 'image-queue' | 'pdf-queue' | 'font-queue' | 'ai-queue';
```

在 `getTaskQueueName` 的 `case 'font_convert':` 之后加：

```ts
    case 'image_generate':
      return 'ai-queue';
```

`apps/api/src/modules/tasks/tasks.service.ts` 的 `isServerTask`，把 `image_generate` 加进返回 `true`
的 server 分支（与 `image_id_photo` 同组）。这一步就让「必须登录」生效——`assertCanCreateTask`
会对它检查 `task.serverProcessing` entitlement，匿名用户被拒。

`apps/web/src/lib/tasks/task-category.ts` 的 `getTaskTypeCategory`，把 `image_generate` 加进
`return 'image'` 分支：

```ts
    case 'image_id_photo':
    case 'image_generate':
      return 'image';
```

`apps/web/src/app/[locale]/(app)/tasks/page.tsx` 的 `labels: Record<TaskType, string>`，加一项：

```ts
    image_generate: t('typeImageGenerate'),
```

这个 key 必须**同一步**加进两个语言文件，否则任务列表页渲染即抛错、`task-category.test.ts`
之外的页面测试也会连带红。`apps/web/messages/zh.json` 的 `TasksTool` 加：

```json
    "typeImageGenerate": "AI 生图",
```

`apps/web/messages/en.json` 的 `TasksTool` 加：

```json
    "typeImageGenerate": "AI image generation",
```

（Task 10 会补齐其余文案，这里只加任务列表标签这一个 key。）

- [ ] **Step 6: `getQueue` 加分支并注入新队列**

`apps/api/src/modules/tasks/tasks.service.ts` 的构造函数，在 `fontQueue`
之后插入（保持队列参数聚在一起）：

```ts
    @InjectQueue('ai-queue') private aiQueue: Queue,
```

`getQueue` 加分支：

```ts
      case 'ai-queue':
        return this.aiQueue;
```

构造函数是位置注入，插入新参数会让单测的手工构造失配。`apps/api/src/modules/tasks/tasks.service.test.ts`
的 `createService` 同步改：

```ts
const imageQueue = queue('image-queue');
const pdfQueue = queue('pdf-queue');
const fontQueue = queue('font-queue');
const aiQueue = queue('ai-queue');
```

`reconcile` 的队列选择加一档：

```ts
const targetQueue =
  identity.queueName === 'image-queue'
    ? imageQueue
    : identity.queueName === 'pdf-queue'
      ? pdfQueue
      : identity.queueName === 'ai-queue'
        ? aiQueue
        : fontQueue;
```

`new TasksService(...)` 的实参在 `fontQueue as any` 之后插入 `aiQueue as any`，并把 `aiQueue`
加进返回对象：

```ts
    service: new TasksService(
      imageQueue as any,
      pdfQueue as any,
      fontQueue as any,
      aiQueue as any,
      filesService as any,
      cleanupObligationService as any,
      taskJobReconciler as any
    ),
    filesService,
    imageQueue,
    pdfQueue,
    fontQueue,
    aiQueue,
    taskJobReconciler,
```

此时 `ai-queue` 尚未在 module 中注册，API 启动会失败——Task 2 补上。本 Task 只需类型检查与单测通过。

- [ ] **Step 7: 生成并执行 migration**

```bash
cd packages/db && bunx drizzle-kit generate
```

预期：生成 `packages/db/drizzle/0015_*.sql`，内容为一行
`ALTER TYPE "public"."task_type" ADD VALUE 'image_generate';`（参照既有
`0006_image_id_photo.sql`）。

```bash
cd packages/db && bunx drizzle-kit migrate
```

预期：migration 应用成功，无报错。

- [ ] **Step 8: 运行测试确认通过**

```bash
bun --cwd apps/api test src/modules/tasks/dto/tasks.dto.test.ts src/modules/tasks/task-queue.test.ts src/modules/tasks/tasks.service.test.ts
bun --cwd apps/web test "src/app/[locale]/(app)/tasks"
```

预期：全部 PASS。第二条覆盖 `task-category.test.ts` 与任务列表页——`Record<TaskType, string>`
缺 key 会编译失败，缺文案会渲染时抛错。

- [ ] **Step 9: 提交**

```bash
git add packages/db packages/validators apps/api/src/modules/tasks apps/web/src/hooks/api/types.ts apps/web/src/lib/tasks/task-category.ts "apps/web/src/app/[locale]/(app)/tasks/page.tsx" apps/web/messages
git commit -m "feat(tasks): 注册 image_generate 任务类型并路由到 ai-queue"
```

---

## Task 2: 注册并接线 ai-queue 队列

Task 1 给 `TasksService`、`AccountTaskQueueService` 注入了
`@InjectQueue('ai-queue')`，但队列本身还没在任何模块注册，且两处运行时派发路径还不认识
`ai-queue`。本任务把 `ai-queue` 真正接进系统，做完 API 才能启动、生图任务才能派发。

`BullModule.registerQueue` 的 provider 是**模块作用域**的：`TasksModule` 注册不会传导到
`AccountModule`，两个模块各自注册自己注入的队列。

五处必须同步（第 3、4 处是 Task 1 spec 审查发现的计划盲区，第 5 处是代码质量审查发现的）：

1. `tasks.module.ts` 注册队列（供 `TasksService` 和 `TaskJobReconciler` 解析）
2. `health.module.ts` 的独立 `queueNames` + 位置注入工厂
3. `account.module.ts` 注册队列（供 `AccountTaskQueueService` 解析，否则 Nest 启动即依赖无法解析）
4. `task-job-reconciler.service.ts` 的 `getQueue` —— 它有 `default` 分支骗过了编译器，但真实派发走
   `reconcile → getQueue`，缺 `ai-queue` 分支会在建生图任务时运行时抛
   `Unsupported task queue ai-queue`
5. `app.module.ts` 的 `BullBoardModule.forFeature` —— 不加则 `/admin/queues`
   队列后台看不到 ai-queue（不影响功能，但漏了监控面板）

**Files:**

- Modify: `apps/api/src/modules/tasks/tasks.module.ts:23-28`
- Modify: `apps/api/src/modules/health/health.module.ts:16-21,44-51`
- Modify: `apps/api/src/modules/account/account.module.ts:13-17`
- Modify: `apps/api/src/modules/tasks/task-job-reconciler.service.ts:28-33,125-136`
- Modify: `apps/api/src/app.module.ts:32-37`
- Test: `apps/api/src/modules/health/health.module.test.ts:17-22,104,154,181`
- Test: `apps/api/src/modules/account/account.module.test.ts:11`
- Test: `apps/api/src/modules/tasks/task-job-reconciler.service.test.ts:47-66`

- [ ] **Step 1: 改测试期望——健康检查覆盖 5 个队列**

`apps/api/src/modules/health/health.module.test.ts`，`queueTokens` 加一项：

```ts
const queueTokens = [
  getQueueToken('image-queue'),
  getQueueToken('pdf-queue'),
  getQueueToken('font-queue'),
  getQueueToken('cleanup-queue'),
  getQueueToken('ai-queue'),
];
```

把三处 `Array.from({ length: 4 }, () => ({` 全部改成 `Array.from({ length: 5 }, () => ({`（分别在
`HEALTH_CHECKS factory` 的三个用例里）。

- [ ] **Step 2: 改测试期望——account.module 与 reconciler**

`apps/api/src/modules/account/account.module.test.ts:11`，队列名数组加 `'ai-queue'`：

```ts
  for (const queue of ['image-queue', 'pdf-queue', 'font-queue', 'ai-queue']) {
```

`apps/api/src/modules/tasks/task-job-reconciler.service.test.ts` 的
`createReconciler`（约 :47-66），在 `fontQueue` 之后加一个 aiQueue，并作为第 4 个实参传入构造：

```ts
const imageQueue = queue('image-queue', events);
const pdfQueue = queue('pdf-queue', events);
const fontQueue = queue('font-queue', events);
const aiQueue = queue('ai-queue', events);
```

```ts
const reconciler = new TaskJobReconciler(
  imageQueue as any,
  pdfQueue as any,
  fontQueue as any,
  aiQueue as any,
  cleanupObligations as any,
  stateRepository as any
);
```

- [ ] **Step 3: 运行测试确认失败**

```bash
bun --cwd apps/api test src/modules/health/health.module.test.ts src/modules/account/account.module.test.ts src/modules/tasks/task-job-reconciler.service.test.ts
```

预期：health 与 account 的 module 测试 FAIL（token/队列名数组不相等）；reconciler 测试因构造函数还只接 5 个参数、第 4 个实参
`aiQueue` 挤掉了 `cleanupObligations`，会以运行时错误或断言失败告终。

- [ ] **Step 4: tasks.module 注册队列**

`apps/api/src/modules/tasks/tasks.module.ts`，`BullModule.registerQueue` 加一项：

```ts
    BullModule.registerQueue(
      { name: 'image-queue' },
      { name: 'pdf-queue' },
      { name: 'font-queue' },
      { name: 'cleanup-queue' },
      { name: 'ai-queue' }
    ),
```

- [ ] **Step 5: health.module 同步队列清单与位置注入**

`apps/api/src/modules/health/health.module.ts`，`queueNames` 加一项：

```ts
const queueNames = ['image-queue', 'pdf-queue', 'font-queue', 'cleanup-queue', 'ai-queue'] as const;
```

`useFactory` 加第 6 个位置参数并纳入 `queues` 数组：

```ts
      useFactory: (
        minioService: MinioService,
        imageQueue: Queue,
        pdfQueue: Queue,
        fontQueue: Queue,
        cleanupQueue: Queue,
        aiQueue: Queue
      ): HealthChecks => {
        const queues = [
          imageQueue,
          pdfQueue,
          fontQueue,
          cleanupQueue,
          aiQueue,
        ];
```

- [ ] **Step 6: account.module 注册队列**

`apps/api/src/modules/account/account.module.ts`，`BullModule.registerQueue` 加 `ai-queue`：

```ts
    BullModule.registerQueue(
      { name: 'image-queue' },
      { name: 'pdf-queue' },
      { name: 'font-queue' },
      { name: 'ai-queue' }
    ),
```

- [ ] **Step 7: reconciler 注入并路由 ai-queue**

`apps/api/src/modules/tasks/task-job-reconciler.service.ts`，构造函数在 `fontQueue` 之后加注入：

```ts
    @InjectQueue('image-queue') private readonly imageQueue: Queue,
    @InjectQueue('pdf-queue') private readonly pdfQueue: Queue,
    @InjectQueue('font-queue') private readonly fontQueue: Queue,
    @InjectQueue('ai-queue') private readonly aiQueue: Queue,
    private readonly cleanupObligationService: CleanupObligationService,
    private readonly stateRepository: TaskJobStateRepository
```

`getQueue` 的 switch（约 :126）在 `font-queue` 之后加分支：

```ts
      case 'font-queue':
        return this.fontQueue;
      case 'ai-queue':
        return this.aiQueue;
```

`TaskJobReconciler` 是 `TasksModule` 的 provider，Step 4 注册后这里的 `@InjectQueue('ai-queue')`
即可解析，不需要额外 registerQueue。

- [ ] **Step 8: app.module 的队列后台暴露 ai-queue**

`apps/api/src/app.module.ts` 的 `BullBoardModule.forFeature`（约 :32-37）加一项，让 `/admin/queues`
能看到新队列：

```ts
    BullBoardModule.forFeature(
      { name: 'image-queue', adapter: BullMQAdapter },
      { name: 'pdf-queue', adapter: BullMQAdapter },
      { name: 'font-queue', adapter: BullMQAdapter },
      { name: 'cleanup-queue', adapter: BullMQAdapter },
      { name: 'ai-queue', adapter: BullMQAdapter }
    ),
```

- [ ] **Step 9: 运行测试确认通过**

```bash
bun --cwd apps/api test src/modules/health/health.module.test.ts src/modules/account/account.module.test.ts src/modules/tasks/task-job-reconciler.service.test.ts
```

预期：全部 PASS。

- [ ] **Step 10: 验证 API 能启动、健康检查就绪、且能派发生图任务**

```bash
cd apps/api && bun run dev
```

另开一个终端：

```bash
curl -s http://localhost:3001/health/ready
```

预期：HTTP 200，`checks.queues` 通过（LibreOffice 缺失时整体 `degraded` +
200 属正常）。API 能正常启动即证明 `AccountTaskQueueService` 的 `ai-queue`
依赖已解析。确认后停掉 dev server。

（真正建一个 `image_generate` 任务验证 reconciler 路由不再抛 `Unsupported task queue`
要等 provider 就位，留到 Task 16 端到端验证。本步只需 API 启动成功 + 健康检查绿。）

- [ ] **Step 11: 提交**

```bash
git add apps/api/src/modules/tasks apps/api/src/modules/health apps/api/src/modules/account apps/api/src/app.module.ts
git commit -m "feat(tasks): 注册并接线 ai-queue 至队列、健康检查、账号清理、派发对账与队列后台"
```

---

## Task 3: 抽取 OpenAI 兼容图像共享模块

只搬生图确实要用的 2 个函数。`normalizeOpenAiCompatibleBaseUrl`（指向
`/v1/chat/completions`）、`stripJsonFence`、`parseMaskReferenceFromOpenAiContent`、`bufferFromMaskReference`
只服务抠图的 `chat_mask` 通道，留在原处不动。

**Files:**

- Create: `apps/api/src/modules/tasks/services/openai-compatible-image.ts`
- Create: `apps/api/src/modules/tasks/services/openai-compatible-image.test.ts`
- Modify: `apps/api/src/modules/tasks/services/portrait-segmentation.service.ts:147-156,199-220`

- [ ] **Step 1: 写失败测试**

新建 `apps/api/src/modules/tasks/services/openai-compatible-image.test.ts`：

```ts
import { describe, expect, it, vi } from 'bun:test';
import {
  bufferFromGeneratedImagePayload,
  normalizeOpenAiCompatibleImageEditUrl,
  normalizeOpenAiCompatibleImageGenerationUrl,
} from './openai-compatible-image';

describe('normalizeOpenAiCompatibleImageGenerationUrl', () => {
  it('appends /v1/images/generations to a bare base url', () => {
    expect(normalizeOpenAiCompatibleImageGenerationUrl('https://api.test')).toBe(
      'https://api.test/v1/images/generations'
    );
  });

  it('does not duplicate an existing /v1 segment', () => {
    expect(normalizeOpenAiCompatibleImageGenerationUrl('https://api.test/v1')).toBe(
      'https://api.test/v1/images/generations'
    );
  });

  it('keeps a base url that already points at the endpoint', () => {
    expect(
      normalizeOpenAiCompatibleImageGenerationUrl('https://api.test/v1/images/generations')
    ).toBe('https://api.test/v1/images/generations');
  });

  it('strips trailing slashes', () => {
    expect(normalizeOpenAiCompatibleImageGenerationUrl('https://api.test/v1///')).toBe(
      'https://api.test/v1/images/generations'
    );
  });
});

describe('normalizeOpenAiCompatibleImageEditUrl', () => {
  it('still resolves the edits endpoint after extraction', () => {
    expect(normalizeOpenAiCompatibleImageEditUrl('https://api.test')).toBe(
      'https://api.test/v1/images/edits'
    );
  });
});

describe('bufferFromGeneratedImagePayload', () => {
  const fetchImpl = vi.fn();

  it.each(['b64_json', 'base64', 'image', 'image_base64'])('decodes the %s field', async field => {
    const payload = { data: [{ [field]: 'aGVsbG8=' }] };
    const buffer = await bufferFromGeneratedImagePayload(
      payload,
      fetchImpl as unknown as typeof fetch
    );
    expect(buffer.toString('utf8')).toBe('hello');
  });

  it('strips a data url prefix before decoding', async () => {
    const payload = { data: [{ b64_json: 'data:image/png;base64,aGVsbG8=' }] };
    const buffer = await bufferFromGeneratedImagePayload(
      payload,
      fetchImpl as unknown as typeof fetch
    );
    expect(buffer.toString('utf8')).toBe('hello');
  });

  it('downloads the image when only a url is returned', async () => {
    const download = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode('hello').buffer,
    }));
    const buffer = await bufferFromGeneratedImagePayload(
      { data: [{ url: 'https://cdn.test/a.png' }] },
      download as unknown as typeof fetch
    );
    expect(download).toHaveBeenCalledWith('https://cdn.test/a.png');
    expect(buffer.toString('utf8')).toBe('hello');
  });

  it('throws when the payload carries no image', async () => {
    await expect(
      bufferFromGeneratedImagePayload({ data: [{}] }, fetchImpl as unknown as typeof fetch)
    ).rejects.toThrow('missing generated image');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun --cwd apps/api test src/modules/tasks/services/openai-compatible-image.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 新建共享模块**

新建 `apps/api/src/modules/tasks/services/openai-compatible-image.ts`。前两个函数从
`portrait-segmentation.service.ts` 原样搬来（`:147-156` 与 `:199-220`），只加 `export`：

```ts
export function normalizeOpenAiCompatibleImageEditUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/images/edits')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/images/edits`;
  }
  return `${trimmed}/v1/images/edits`;
}

export function normalizeOpenAiCompatibleImageGenerationUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/images/generations')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/images/generations`;
  }
  return `${trimmed}/v1/images/generations`;
}

export async function bufferFromGeneratedImagePayload(
  payload: unknown,
  fetchImpl: typeof fetch
): Promise<Buffer> {
  const data = (payload as { data?: Array<Record<string, unknown>> }).data?.[0];
  const image = data?.b64_json ?? data?.base64 ?? data?.image ?? data?.image_base64;
  if (typeof image === 'string' && image.trim()) {
    return Buffer.from(image.replace(/^data:[^,]+,/, ''), 'base64');
  }

  const url = data?.url;
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error('OpenAI-compatible image response missing generated image');
}
```

- [ ] **Step 4: 让抠图 service 改用共享模块**

`apps/api/src/modules/tasks/services/portrait-segmentation.service.ts`：删掉
`normalizeOpenAiCompatibleImageEditUrl`（`:147-156`）与
`bufferFromGeneratedImagePayload`（`:199-220`）两个函数定义，在文件顶部 import 区加：

```ts
import {
  bufferFromGeneratedImagePayload,
  normalizeOpenAiCompatibleImageEditUrl,
} from './openai-compatible-image';
```

其余调用点不动。

- [ ] **Step 5: 运行测试确认新模块通过且抠图无回归**

```bash
bun --cwd apps/api test src/modules/tasks/services/openai-compatible-image.test.ts src/modules/tasks/services/portrait-segmentation.service.spec.ts
```

预期：全部 PASS。`portrait-segmentation.service.spec.ts` 是这次抽取的回归护栏，必须绿。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/modules/tasks/services
git commit -m "refactor(tasks): 抽取 OpenAI 兼容图像 URL 与响应解析共享模块"
```

---

## Task 4: 生图任务配置 schema

**Files:**

- Create: `packages/validators/src/image-generate.ts`
- Create: `packages/validators/src/image-generate.test.ts`
- Modify: `packages/validators/src/index.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/validators/src/image-generate.test.ts`：

```ts
import { describe, expect, it } from 'bun:test';
import { imageGenerateTaskConfigSchema } from './image-generate';

const base = {
  mode: 'text_to_image' as const,
  prompt: '一只戴礼帽的柴犬',
};

describe('imageGenerateTaskConfigSchema', () => {
  it('applies defaults for size and quality', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      ...base,
      inputFileCount: 0,
    });

    expect(parsed.size).toBe('1024x1024');
    expect(parsed.quality).toBe('high');
    expect(parsed.style).toBeUndefined();
  });

  it('rejects an empty prompt', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        ...base,
        prompt: '   ',
        inputFileCount: 0,
      })
    ).toThrow();
  });

  it('rejects a prompt longer than 2000 characters', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        ...base,
        prompt: 'a'.repeat(2001),
        inputFileCount: 0,
      })
    ).toThrow();
  });

  it('requires zero input files for text_to_image', () => {
    expect(() => imageGenerateTaskConfigSchema.parse({ ...base, inputFileCount: 1 })).toThrow(
      'text_to_image'
    );
  });

  it('requires exactly one input file for image_to_image', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        mode: 'image_to_image',
        prompt: 'x',
        inputFileCount: 0,
      })
    ).toThrow('image_to_image');
  });

  it('requires exactly two input files for inpaint', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        mode: 'inpaint',
        prompt: 'x',
        inputFileCount: 1,
      })
    ).toThrow('inpaint');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun test packages/validators/src/image-generate.test.ts
```

预期：FAIL，模块不存在。

（`packages/validators` 没有自己的 `test` 脚本，包内测试统一从仓库根用
`bun test packages/<name>/src` 运行，见根 `package.json` 的 `test:packages`。）

- [ ] **Step 3: 实现 schema**

新建 `packages/validators/src/image-generate.ts`：

```ts
import { z } from 'zod';

export const imageGenerateModeEnum = z.enum(['text_to_image', 'image_to_image', 'inpaint']);

export const imageGenerateSizeEnum = z.enum(['1024x1024', '1024x1536', '1536x1024']);

export const imageGenerateQualityEnum = z.enum(['standard', 'high']);

export const imageGenerateStyleEnum = z.enum([
  'photographic',
  'illustration',
  'anime',
  'three_d',
  'watercolor',
  'line_art',
]);

/** 每个 mode 要求的输入文件数量,用于把模式契约收在一处。 */
export const IMAGE_GENERATE_INPUT_FILE_COUNT: Record<
  z.infer<typeof imageGenerateModeEnum>,
  number
> = {
  text_to_image: 0,
  image_to_image: 1,
  inpaint: 2,
};

export const imageGenerateTaskConfigSchema = z
  .object({
    mode: imageGenerateModeEnum,
    prompt: z.string().trim().min(1).max(2000),
    size: imageGenerateSizeEnum.default('1024x1024'),
    quality: imageGenerateQualityEnum.default('high'),
    style: imageGenerateStyleEnum.optional(),
    /** 由 processor 传入 task.inputFileIds.length,不由客户端提供。 */
    inputFileCount: z.number().int().min(0),
  })
  .superRefine((value, ctx) => {
    const expected = IMAGE_GENERATE_INPUT_FILE_COUNT[value.mode];
    if (value.inputFileCount !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inputFileCount'],
        message: `mode ${value.mode} requires exactly ${expected} input file(s)`,
      });
    }
  });

export type ImageGenerateMode = z.infer<typeof imageGenerateModeEnum>;
export type ImageGenerateSize = z.infer<typeof imageGenerateSizeEnum>;
export type ImageGenerateQuality = z.infer<typeof imageGenerateQualityEnum>;
export type ImageGenerateStyle = z.infer<typeof imageGenerateStyleEnum>;
export type ImageGenerateTaskConfig = z.infer<typeof imageGenerateTaskConfigSchema>;
```

- [ ] **Step 4: 导出**

`packages/validators/src/index.ts` 加一行（保持字母序，放在 `./id-photo` 之后）：

```ts
export * from './image-generate';
```

- [ ] **Step 5: 运行测试确认通过**

```bash
bun test packages/validators/src
```

预期：全部 PASS（含既有 `id-photo.test.ts`、`watermark.test.ts`）。

- [ ] **Step 6: 提交**

```bash
git add packages/validators
git commit -m "feat(validators): 新增生图任务配置 schema"
```

---

## Task 5: 新增生图相关 error code

**Files:**

- Modify: `apps/api/src/common/errors/error-codes.ts`

- [ ] **Step 1: 加 error code**

`apps/api/src/common/errors/error-codes.ts`，在 `ID_PHOTO_RENDER_FAILED` 之后追加四项：

```ts
  AI_IMAGE_NOT_CONFIGURED: 'AI_IMAGE_NOT_CONFIGURED',
  AI_IMAGE_GENERATION_FAILED: 'AI_IMAGE_GENERATION_FAILED',
  AI_IMAGE_CONTENT_REJECTED: 'AI_IMAGE_CONTENT_REJECTED',
  AI_IMAGE_DAILY_LIMIT_EXCEEDED: 'AI_IMAGE_DAILY_LIMIT_EXCEEDED',
```

- [ ] **Step 2: 类型检查**

```bash
bun --cwd apps/api run build
```

预期：编译通过。

- [ ] **Step 3: 提交**

```bash
git add apps/api/src/common/errors/error-codes.ts
git commit -m "feat(api): 新增 AI 生图错误码"
```

---

## Task 6: ImageGenerationService（文生图）

provider 调用层。关键约束：**上游报错原文只进日志，不进抛出的 message**，因为 `/tasks/:id/status`
会公开返回 `errorMessage`，而图像 provider 拒绝违规 prompt 时常回显原 prompt。

**Files:**

- Create: `apps/api/src/modules/tasks/services/image-generation.service.ts`
- Create: `apps/api/src/modules/tasks/services/image-generation.service.spec.ts`
- Modify: `apps/api/src/modules/tasks/tasks.module.ts`

- [ ] **Step 1: 写失败测试**

新建 `apps/api/src/modules/tasks/services/image-generation.service.spec.ts`：

```ts
import { describe, expect, it, vi } from 'bun:test';
import { ErrorCodes } from '../../../common/errors/error-codes';
import {
  ImageGenerationError,
  ImageGenerationService,
  OpenAiCompatibleImageGenerationProvider,
} from './image-generation.service';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const config = {
  mode: 'text_to_image' as const,
  prompt: '一只戴礼帽的柴犬',
  size: '1024x1024' as const,
  quality: 'high' as const,
  inputFileCount: 0,
};

describe('OpenAiCompatibleImageGenerationProvider', () => {
  it('posts prompt, size and quality to the generations endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] }));
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      apiKey: 'sk-test',
      model: 'gpt-image-1',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const buffer = await provider.generate(config);

    expect(buffer.toString('utf8')).toBe('hello');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/images/generations');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'gpt-image-1',
      prompt: '一只戴礼帽的柴犬',
      size: '1024x1024',
      quality: 'high',
      n: 1,
    });
  });

  it('prefixes the prompt with the selected style template', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] }));
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate({ ...config, style: 'anime' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.prompt.startsWith('一只戴礼帽的柴犬')).toBe(false);
    expect(body.prompt).toContain('一只戴礼帽的柴犬');
  });

  it('throws immediately when baseUrl is missing', () => {
    // 显式传 undefined 会落回构造默认值 process.env.AI_IMAGE_BASE_URL,
    // 所以必须先清掉环境变量,否则本机配了 key 时这条会假绿。
    const original = process.env.AI_IMAGE_BASE_URL;
    delete process.env.AI_IMAGE_BASE_URL;
    try {
      expect(() => new OpenAiCompatibleImageGenerationProvider({})).toThrow(
        'AI_IMAGE_BASE_URL is not configured'
      );
    } finally {
      if (original !== undefined) process.env.AI_IMAGE_BASE_URL = original;
    }
  });

  it('maps a content policy rejection to its own error code', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message: 'Your prompt "一只戴礼帽的柴犬" was rejected by our safety system',
            code: 'content_policy_violation',
          },
        },
        400
      )
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const error = (await provider.generate(config).catch(caught => caught)) as ImageGenerationError;

    expect(error).toBeInstanceOf(ImageGenerationError);
    expect(error.code).toBe(ErrorCodes.AI_IMAGE_CONTENT_REJECTED);
    expect(error.message).not.toContain('一只戴礼帽的柴犬');
  });

  it('maps other upstream failures to a generic error without echoing the body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: 'prompt=一只戴礼帽的柴犬 upstream boom' } }, 500)
    );
    const provider = new OpenAiCompatibleImageGenerationProvider({
      baseUrl: 'https://api.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const error = (await provider.generate(config).catch(caught => caught)) as ImageGenerationError;

    expect(error.code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
    expect(error.message).not.toContain('一只戴礼帽的柴犬');
    expect(error.message).not.toContain('upstream boom');
  });
});

describe('ImageGenerationService', () => {
  it('reports itself unconfigured and refuses to generate without a provider', async () => {
    const service = new ImageGenerationService({ externalProvider: null });

    expect(service.configured).toBe(false);
    const error = (await service.generate(config).catch(caught => caught)) as ImageGenerationError;
    expect(error.code).toBe(ErrorCodes.AI_IMAGE_NOT_CONFIGURED);
  });

  it('delegates to the injected provider and reports PNG output', async () => {
    const generate = vi.fn(async () => Buffer.from('hello'));
    const service = new ImageGenerationService({
      externalProvider: { generate },
    });

    const result = await service.generate(config);

    expect(generate).toHaveBeenCalledWith(config);
    expect(result.mimeType).toBe('image/png');
    expect(result.extension).toBe('png');
    expect(result.buffer.toString('utf8')).toBe('hello');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun --cwd apps/api test src/modules/tasks/services/image-generation.service.spec.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 service（第一部分：错误类、风格模板、辅助函数）**

新建 `apps/api/src/modules/tasks/services/image-generation.service.ts`：

```ts
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { ImageGenerateStyle, ImageGenerateTaskConfig } from '@utils-plane/validators';
import { ErrorCodes } from '../../../common/errors/error-codes';
import {
  bufferFromGeneratedImagePayload,
  normalizeOpenAiCompatibleImageGenerationUrl,
} from './openai-compatible-image';

const DEFAULT_AI_IMAGE_MODEL = 'gpt-image-1';

/** 上游报错里出现这些标记时判定为内容策略拒绝。 */
const CONTENT_REJECTION_MARKERS = [
  'content_policy',
  'content policy',
  'safety system',
  'moderation',
  'safety_violation',
];

const STYLE_PROMPT_PREFIX: Record<ImageGenerateStyle, string> = {
  photographic: 'A photorealistic photograph, natural lighting, sharp focus, 50mm lens. Subject: ',
  illustration: 'A clean digital illustration, flat colors, confident linework. Subject: ',
  anime: 'Anime illustration, cel shading, expressive eyes. Subject: ',
  three_d: 'A 3D rendered image, soft studio lighting, subtle depth of field. Subject: ',
  watercolor: 'A watercolor painting, visible paper texture, soft bleeding edges. Subject: ',
  line_art: 'Minimal black and white line art, uniform stroke width, no shading. Subject: ',
};

export class ImageGenerationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

export interface ImageGenerationProvider {
  generate(config: ImageGenerateTaskConfig): Promise<Buffer>;
}

export interface OpenAiCompatibleImageGenerationProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  responseFormat?: string;
  fetch?: typeof fetch;
}

export function buildImageGenerationPrompt(
  config: Pick<ImageGenerateTaskConfig, 'prompt' | 'style'>
): string {
  const prefix = config.style ? STYLE_PROMPT_PREFIX[config.style] : '';
  return `${prefix}${config.prompt}`;
}
```

- [ ] **Step 4: 实现 service（第二部分：provider 类）**

追加到同一文件：

```ts
export class OpenAiCompatibleImageGenerationProvider implements ImageGenerationProvider {
  private readonly logger = new Logger(OpenAiCompatibleImageGenerationProvider.name);
  private readonly generationUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly responseFormat: string;
  private readonly fetchImpl: typeof fetch;

  constructor({
    baseUrl = process.env.AI_IMAGE_BASE_URL,
    apiKey = process.env.AI_IMAGE_API_KEY,
    model = process.env.AI_IMAGE_MODEL ?? DEFAULT_AI_IMAGE_MODEL,
    responseFormat = process.env.AI_IMAGE_RESPONSE_FORMAT ?? 'b64_json',
    fetch: fetchImpl = fetch,
  }: OpenAiCompatibleImageGenerationProviderOptions = {}) {
    if (!baseUrl) {
      throw new Error('AI_IMAGE_BASE_URL is not configured');
    }
    this.generationUrl = normalizeOpenAiCompatibleImageGenerationUrl(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.responseFormat = responseFormat;
    this.fetchImpl = fetchImpl;
  }

  async generate(config: ImageGenerateTaskConfig): Promise<Buffer> {
    const response = await this.fetchImpl(this.generationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        prompt: buildImageGenerationPrompt(config),
        size: config.size,
        quality: config.quality,
        response_format: this.responseFormat,
        n: 1,
      }),
    });

    if (!response.ok) {
      throw this.toSanitizedError(response.status, await this.readBody(response));
    }

    try {
      return await bufferFromGeneratedImagePayload(await response.json(), this.fetchImpl);
    } catch (error) {
      this.logger.warn(`AI image generation response could not be decoded: ${String(error)}`);
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed'
      );
    }
  }

  private async readBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }

  /** 上游原文只进日志。抛出的 message 必须是固定文案,它会经公开的任务状态接口外泄。 */
  private toSanitizedError(status: number, body: string): ImageGenerationError {
    this.logger.warn(
      `AI image generation upstream failed: status=${status} body=${body.slice(0, 2000)}`
    );

    const lowered = body.toLowerCase();
    const rejected = CONTENT_REJECTION_MARKERS.some(marker => lowered.includes(marker));

    return rejected
      ? new ImageGenerationError(
          ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
          'The prompt was rejected by the provider content policy'
        )
      : new ImageGenerationError(ErrorCodes.AI_IMAGE_GENERATION_FAILED, 'Image generation failed');
  }
}
```

- [ ] **Step 5: 实现 service（第三部分：Nest service 包装）**

追加到同一文件：

```ts
export interface ImageGenerationServiceOptions {
  externalProvider?: ImageGenerationProvider | null;
}

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  private readonly provider: ImageGenerationProvider | null;

  constructor(@Optional() options?: ImageGenerationServiceOptions) {
    if (options && 'externalProvider' in options) {
      this.provider = options.externalProvider ?? null;
    } else if (process.env.AI_IMAGE_BASE_URL) {
      this.provider = new OpenAiCompatibleImageGenerationProvider();
    } else {
      this.provider = null;
      this.logger.log('AI_IMAGE_BASE_URL is not set; image generation stays disabled');
    }
  }

  get configured(): boolean {
    return this.provider !== null;
  }

  async generate(config: ImageGenerateTaskConfig): Promise<GeneratedImage> {
    if (!this.provider) {
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_NOT_CONFIGURED,
        'AI image generation is not configured'
      );
    }

    const buffer = await this.provider.generate(config);
    return { buffer, mimeType: 'image/png', extension: 'png' };
  }
}
```

- [ ] **Step 6: 注册到 TasksModule**

`apps/api/src/modules/tasks/tasks.module.ts`，import 区加：

```ts
import { ImageGenerationService } from './services/image-generation.service';
```

`providers` 数组在 `PortraitSegmentationService` 之后加：

```ts
    ImageGenerationService,
```

- [ ] **Step 7: 运行测试确认通过**

```bash
bun --cwd apps/api test src/modules/tasks/services/image-generation.service.spec.ts
```

预期：全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add apps/api/src/modules/tasks
git commit -m "feat(tasks): 新增 OpenAI 兼容文生图 service"
```

---

## Task 7: 每日生成配额

不新建表。COUNT 放进 `createTask` 已有的事务里——`withActiveUserTransaction` 对 user 行持
`FOR UPDATE`（`apps/api/src/common/database/active-user-transaction.ts:45-50`），同一用户的并发建任务天然串行，COUNT 不会超发。

计数查询单独放一个模块，这样 `tasks.service.test.ts` 可以用 `mock.module` 替换掉它，不必去 mock
drizzle 的 select 链。

**Files:**

- Modify: `packages/utils/src/entitlements.ts:29-39,65-146`
- Create: `apps/api/src/modules/tasks/daily-task-quota.ts`
- Create: `apps/api/src/modules/tasks/daily-task-quota.test.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts` (`createTask`)
- Test: `apps/api/src/modules/tasks/tasks.service.test.ts`

- [ ] **Step 1: 加 LimitKey 与配额值**

`packages/utils/src/entitlements.ts`，`LimitKey` 联合末尾加：

```ts
  | 'aiImage.dailyCount';
```

（把原来 `| 'image.stitch.maxCanvasPixels';` 的分号移到新行末尾。）

`LIMITS` 对象末尾加一项。`free` 档永远读不到——功能要求登录——按结构补 0 即可：

```ts
  'aiImage.dailyCount': {
    free: 0,
    signed_in: 10,
    pro_preview: 100,
    pro: 50,
    team: 80,
    private: 100,
  },
```

- [ ] **Step 2: 写失败测试——计数模块**

新建 `apps/api/src/modules/tasks/daily-task-quota.test.ts`：

```ts
import { describe, expect, it, vi } from 'bun:test';
import { countTasksCreatedToday } from './daily-task-quota';

function fakeDatabase(count: number) {
  const where = vi.fn(async () => [{ count }]);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { database: { select }, select, from, where };
}

describe('countTasksCreatedToday', () => {
  it('returns the counted rows', async () => {
    const { database } = fakeDatabase(7);

    await expect(
      countTasksCreatedToday(database as never, 'user-1', 'image_generate')
    ).resolves.toBe(7);
  });

  it('treats a missing row as zero', async () => {
    const where = vi.fn(async () => []);
    const database = { select: vi.fn(() => ({ from: () => ({ where }) })) };

    await expect(
      countTasksCreatedToday(database as never, 'user-1', 'image_generate')
    ).resolves.toBe(0);
  });

  it('builds one select against a single where clause', async () => {
    const { database, select, from, where } = fakeDatabase(0);

    await countTasksCreatedToday(database as never, 'user-1', 'image_generate');

    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
bun --cwd apps/api test src/modules/tasks/daily-task-quota.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 4: 实现计数模块**

新建 `apps/api/src/modules/tasks/daily-task-quota.ts`：

```ts
import { tasks } from '@utils-plane/db';
import type { TaskType } from '@utils-plane/validators';
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import type { ActiveUserTransaction } from '../../common/database/active-user-transaction';

/**
 * 统计某用户当天已创建的指定类型任务数,用于每日配额判定。
 *
 * 命中 tasks_user_created_idx (user_id, created_at) 索引。
 * failed 不计数:provider 报错不该扣用户额度。
 * date_trunc 走数据库时区,与 created_at 的写入时区一致。
 */
export async function countTasksCreatedToday(
  database: Pick<ActiveUserTransaction, 'select'>,
  userId: string,
  type: TaskType
): Promise<number> {
  const rows = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.type, type),
        ne(tasks.status, 'failed'),
        gte(tasks.createdAt, sql`date_trunc('day', now())`)
      )
    );

  return rows[0]?.count ?? 0;
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
bun --cwd apps/api test src/modules/tasks/daily-task-quota.test.ts
```

预期：全部 PASS。

- [ ] **Step 6: 写失败测试——配额在 service 层生效**

`apps/api/src/modules/tasks/tasks.service.test.ts`。先在
`mock.module('../../common/database/active-user-transaction', ...)`
之后、`await import('./tasks.service')` **之前**加一个 mock：

```ts
const countTasksCreatedToday = vi.fn(async () => 0);
mock.module('./daily-task-quota', () => ({ countTasksCreatedToday }));
```

`beforeEach` 里补一行重置，避免用例间串味：

```ts
countTasksCreatedToday.mockResolvedValue(0);
```

在 `describe('TasksService task creation', ...)` 内追加两个用例：

```ts
it('allows an image generation task while under the daily quota', async () => {
  const { service } = createService();
  countTasksCreatedToday.mockResolvedValue(9);

  await expect(
    service.create(
      {
        type: 'image_generate',
        inputFileIds: [],
        inputConfig: { mode: 'text_to_image', prompt: 'x' },
      },
      { id: 'user-1', plan: 'signed_in', role: 'user' } as never
    )
  ).resolves.toMatchObject({ type: 'image_generate' });
});

it('rejects an image generation task once the daily quota is reached', async () => {
  const { service, aiQueue } = createService();
  countTasksCreatedToday.mockResolvedValue(10);

  await expect(
    service.create(
      {
        type: 'image_generate',
        inputFileIds: [],
        inputConfig: { mode: 'text_to_image', prompt: 'x' },
      },
      { id: 'user-1', plan: 'signed_in', role: 'user' } as never
    )
  ).rejects.toThrow(ErrorCodes.AI_IMAGE_DAILY_LIMIT_EXCEEDED);

  expect(transactionInsert).not.toHaveBeenCalled();
  expect(aiQueue.add).not.toHaveBeenCalled();
  expect(events).toContain('rollback');
});
```

- [ ] **Step 7: 运行测试确认失败**

```bash
bun --cwd apps/api test src/modules/tasks/tasks.service.test.ts
```

预期：第二个新用例 FAIL——当前没有配额判定，任务会被正常创建。

- [ ] **Step 8: 在 createTask 内加配额判定**

`apps/api/src/modules/tasks/tasks.service.ts`。import 区加：

```ts
import { getLimit } from '@utils-plane/utils';
import { countTasksCreatedToday } from './daily-task-quota';
```

（`getLimit` 若已在该文件 import 过就不必重复；`canUseFeature` 已在用，通常是同一条 import 语句。）

新增私有方法：

```ts
  /**
   * 生图有真实外部计费,必须限每日张数。
   *
   * 放在事务内,借 withActiveUserTransaction 已持有的 user 行锁保证并发不超发。
   */
  private async assertWithinDailyQuota(
    type: TaskType,
    user: Pick<User, 'id' | 'plan' | 'role'> | null,
    database: ActiveUserTransaction
  ): Promise<void> {
    if (type !== 'image_generate' || !user) return;

    const limit = getLimit(
      { userId: user.id, plan: user.plan, role: user.role },
      'aiImage.dailyCount'
    );
    const used = await countTasksCreatedToday(database, user.id, type);

    if (used >= limit) {
      throw new ForbiddenException({
        code: ErrorCodes.AI_IMAGE_DAILY_LIMIT_EXCEEDED,
        message: `Daily image generation limit of ${limit} reached`,
      });
    }
  }
```

在 `createTask` 的 `assertCanAccessInputFiles` 之后插入调用：

```ts
await this.assertCanAccessInputFiles(input, user, database);
await this.assertWithinDailyQuota(input.type, user, database);
```

- [ ] **Step 9: 运行测试确认通过**

```bash
bun --cwd apps/api test src/modules/tasks
bun test packages/utils/src
```

预期：全部 PASS。

- [ ] **Step 10: 提交**

```bash
git add packages/utils apps/api/src/modules/tasks
git commit -m "feat(tasks): 生图任务加每日配额,复用 tasks 表计数与用户行锁"
```

---

## Task 8: AiImageProcessor 与生成内容标识

**Files:**

- Create: `apps/api/src/modules/tasks/processors/ai-image.processor.ts`
- Create: `apps/api/src/modules/tasks/processors/ai-image.processor.spec.ts`
- Create: `apps/api/src/modules/tasks/services/generated-image-marker.ts`
- Create: `apps/api/src/modules/tasks/services/generated-image-marker.test.ts`
- Modify: `apps/api/src/modules/tasks/tasks.module.ts`

- [ ] **Step 1: 写失败测试——生成内容标识**

sharp 0.34 可以把 EXIF 的 `Software` / `ImageDescription` 写进 PNG 的 `eXIf`
chunk 并读回（已实测验证）。

新建 `apps/api/src/modules/tasks/services/generated-image-marker.test.ts`：

```ts
import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { markGeneratedImage } from './generated-image-marker';

async function solidPng(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer();
}

describe('markGeneratedImage', () => {
  it('embeds the generator and model as readable EXIF metadata', async () => {
    const tagged = await markGeneratedImage(await solidPng(), {
      model: 'gpt-image-1',
      generatedAt: new Date('2026-08-22T10:00:00.000Z'),
    });

    const metadata = await sharp(tagged).metadata();
    expect(metadata.format).toBe('png');
    const exif = metadata.exif?.toString('latin1') ?? '';
    expect(exif).toContain('Utils-Plane');
    expect(exif).toContain('gpt-image-1');
    expect(exif).toContain('2026-08-22');
  });

  it('never embeds the prompt', async () => {
    const tagged = await markGeneratedImage(await solidPng(), {
      model: 'gpt-image-1',
      generatedAt: new Date('2026-08-22T10:00:00.000Z'),
    });

    const exif = (await sharp(tagged).metadata()).exif?.toString('latin1') ?? '';
    expect(exif).not.toContain('prompt');
  });

  it('keeps the output decodable as a valid image', async () => {
    const tagged = await markGeneratedImage(await solidPng(), {
      model: 'm',
      generatedAt: new Date(),
    });

    const { width, height } = await sharp(tagged).metadata();
    expect(width).toBe(8);
    expect(height).toBe(8);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun --cwd apps/api test src/modules/tasks/services/generated-image-marker.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现标识模块**

新建 `apps/api/src/modules/tasks/services/generated-image-marker.ts`：

```ts
import sharp from 'sharp';

export interface GeneratedImageMarkerOptions {
  model: string;
  generatedAt: Date;
}

/**
 * 给 AI 生成图写入隐式来源标识(生成方、模型、生成时间)。
 *
 * 只写不可争议的来源事实,绝不写 prompt —— 产物文件可能被用户分享出去。
 * 不加可见水印。
 */
export async function markGeneratedImage(
  input: Buffer,
  { model, generatedAt }: GeneratedImageMarkerOptions
): Promise<Buffer> {
  return sharp(input)
    .withMetadata({
      exif: {
        IFD0: {
          Software: 'Utils-Plane AI Image Generation',
          ImageDescription: `AI-generated image; model=${model}; generatedAt=${generatedAt.toISOString()}`,
        },
      },
    })
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun --cwd apps/api test src/modules/tasks/services/generated-image-marker.test.ts
```

预期：全部 PASS。

- [ ] **Step 5: 写失败测试——processor**

新建 `apps/api/src/modules/tasks/processors/ai-image.processor.spec.ts`：

```ts
import { expect, it, mock, vi } from 'bun:test';
import { ErrorCodes } from '../../../common/errors/error-codes';

const getTaskOutputOwner = mock(async () => ({
  id: 'user-1',
  plan: 'signed_in',
  role: 'user',
}));

mock.module('./task-output-owner', () => ({ getTaskOutputOwner }));
mock.module('../services/generated-image-marker', () => ({
  markGeneratedImage: mock(async (buffer: Buffer) => buffer),
}));

const { AiImageProcessor } = await import('./ai-image.processor');
const { ImageGenerationError } = await import('../services/image-generation.service');

function createTasksService(overrides: Record<string, unknown> = {}) {
  return {
    getById: vi.fn().mockResolvedValue({
      id: 'task-1',
      type: 'image_generate',
      userId: 'user-1',
      inputFileIds: [],
      inputConfig: { mode: 'text_to_image', prompt: '一只柴犬' },
      ...overrides,
    }),
    markProcessing: vi.fn(),
    updateProgress: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  };
}

const job = {
  id: 'job-1',
  data: { taskId: 'task-1' },
  attemptsMade: 0,
  updateProgress: vi.fn(),
  opts: {},
} as never;

it('generates an image and stores it against the task owner', async () => {
  const filesService = {
    upload: vi.fn().mockResolvedValue({ id: 'output-1' }),
  };
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi.fn().mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      extension: 'png',
    }),
  };

  const processor = new AiImageProcessor(
    filesService as never,
    tasksService as never,
    imageGenerationService as never
  );

  await processor.process(job);

  expect(imageGenerationService.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'text_to_image',
      prompt: '一只柴犬',
      size: '1024x1024',
      quality: 'high',
      inputFileCount: 0,
    })
  );
  expect(getTaskOutputOwner).toHaveBeenCalledWith('user-1');
  expect(filesService.upload).toHaveBeenCalledWith(
    Buffer.from('png-bytes'),
    expect.objectContaining({ mimeType: 'image/png' }),
    { id: 'user-1', plan: 'signed_in', role: 'user' }
  );
  expect(tasksService.markCompleted).toHaveBeenCalledWith('task-1', 'output-1');
});

it('marks the task failed with the provider error code and a fixed message', async () => {
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi
      .fn()
      .mockRejectedValue(
        new ImageGenerationError(
          ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
          'The prompt was rejected by the provider content policy'
        )
      ),
  };

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    imageGenerationService as never
  );

  await expect(processor.process(job)).rejects.toThrow();

  expect(tasksService.markFailed).toHaveBeenCalledWith(
    'task-1',
    ErrorCodes.AI_IMAGE_CONTENT_REJECTED,
    'The prompt was rejected by the provider content policy'
  );
});

it('does not leak an unexpected error message into the task record', async () => {
  const tasksService = createTasksService();
  const imageGenerationService = {
    generate: vi.fn().mockRejectedValue(new Error('boom with prompt 一只柴犬 inside')),
  };

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    imageGenerationService as never
  );

  await expect(processor.process(job)).rejects.toThrow();

  const [, code, message] = tasksService.markFailed.mock.calls[0] as string[];
  expect(code).toBe(ErrorCodes.AI_IMAGE_GENERATION_FAILED);
  expect(message).not.toContain('一只柴犬');
  expect(message).not.toContain('boom');
});

it('rejects a mode this processor does not implement yet', async () => {
  const tasksService = createTasksService({
    inputConfig: { mode: 'image_to_image', prompt: 'x' },
    inputFileIds: ['file-1'],
  });

  const processor = new AiImageProcessor(
    { upload: vi.fn() } as never,
    tasksService as never,
    { generate: vi.fn() } as never
  );

  await expect(processor.process(job)).rejects.toThrow();
  expect(tasksService.markFailed).toHaveBeenCalled();
});
```

在 `apps/api/src/modules/tasks/processors/image.processor.spec.ts`
的第二个用例里，把新 processor 加进被校验的清单：

```ts
  for (const processor of [
    'image.processor.ts',
    'pdf.processor.ts',
    'font.processor.ts',
    'ai-image.processor.ts',
  ]) {
```

- [ ] **Step 6: 运行测试确认失败**

```bash
bun --cwd apps/api test src/modules/tasks/processors
```

预期：`ai-image.processor.spec.ts` FAIL，模块不存在；`image.processor.spec.ts` 的清单用例也 FAIL。

- [ ] **Step 7: 实现 processor**

新建 `apps/api/src/modules/tasks/processors/ai-image.processor.ts`：

```ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { imageGenerateTaskConfigSchema } from '@utils-plane/validators';
import { Job } from 'bullmq';
import { ErrorCodes } from '../../../common/errors/error-codes';
import { FilesService } from '../../files/files.service';
import { markGeneratedImage } from '../services/generated-image-marker';
import { ImageGenerationError, ImageGenerationService } from '../services/image-generation.service';
import { TasksService } from '../tasks.service';
import { getTaskOutputOwner } from './task-output-owner';

type AiImageTask = {
  id: string;
  type: string;
  userId?: string | null;
  inputFileIds?: string[] | null;
  inputConfig?: unknown;
};

/**
 * 生图是远程 HTTP 等待型负载,并发可以开高,单任务耗时可能到分钟级。
 * 不与 image-queue 共用:那里的 concurrency 是为 sharp/ONNX 的 CPU 负载调的。
 */
@Processor('ai-queue', {
  concurrency: 8,
  lockDuration: 600000,
})
export class AiImageProcessor extends WorkerHost {
  private readonly logger = new Logger(AiImageProcessor.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
    private readonly imageGenerationService: ImageGenerationService
  ) {
    super();
  }

  async process(job: Job<{ taskId: string }>): Promise<unknown> {
    const { taskId } = job.data;
    this.logger.log(`[START] jobId=${job.id}, taskId=${taskId}, attempt=${job.attemptsMade}`);
    const task = await this.tasksService.getById(taskId);

    try {
      await this.tasksService.markProcessing(taskId);

      switch (task.type) {
        case 'image_generate':
          return await this.handleGenerate(task, job);
        default:
          throw new Error(`Unknown AI image task type: ${task.type}`);
      }
    } catch (err) {
      await this.markFailedSafely(taskId, err);
      throw err;
    }
  }

  /**
   * markFailed 写入的 message 会经公开的 GET /tasks/:id/status 外泄。
   * 只有 ImageGenerationError 的固定文案可以落库,其余一律换成通用文案,
   * 原文进日志 —— provider 报错常回显用户 prompt。
   */
  private async markFailedSafely(taskId: string, err: unknown): Promise<void> {
    const known = err instanceof ImageGenerationError;
    if (!known) {
      this.logger.error(`AI image task ${taskId} failed unexpectedly: ${String(err)}`);
    }

    try {
      await this.tasksService.markFailed(
        taskId,
        known ? err.code : ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        known ? err.message : 'Image generation failed'
      );
    } catch (dbErr) {
      this.logger.error(`Failed to mark task ${taskId} as failed: ${(dbErr as Error).message}`);
    }
  }

  private async reportProgress(taskId: string, job: Job, value: number) {
    await Promise.all([job.updateProgress(value), this.tasksService.updateProgress(taskId, value)]);
  }

  private async handleGenerate(task: AiImageTask, job: Job): Promise<unknown> {
    const config = imageGenerateTaskConfigSchema.parse({
      ...(task.inputConfig as Record<string, unknown>),
      inputFileCount: task.inputFileIds?.length ?? 0,
    });
    await this.reportProgress(task.id, job, 10);

    if (config.mode !== 'text_to_image') {
      throw new ImageGenerationError(
        ErrorCodes.AI_IMAGE_GENERATION_FAILED,
        'Image generation failed'
      );
    }
    await this.reportProgress(task.id, job, 30);

    const generated = await this.imageGenerationService.generate(config);
    await this.reportProgress(task.id, job, 80);

    const marked = await markGeneratedImage(generated.buffer, {
      model: process.env.AI_IMAGE_MODEL ?? 'unknown',
      generatedAt: new Date(),
    });

    const outputOwner = await getTaskOutputOwner(task.userId);
    const outputFile = await this.filesService.upload(
      marked,
      {
        filename: `ai-image-${task.id.slice(0, 8)}.${generated.extension}`,
        mimeType: generated.mimeType,
        size: marked.length,
      },
      outputOwner
    );
    await this.reportProgress(task.id, job, 95);

    await this.tasksService.markCompleted(task.id, outputFile.id);
    await job.updateProgress(100);
    return { outputFileId: outputFile.id };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`);
    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts?.attempts ?? 3;
    if (attemptsMade >= maxAttempts) {
      const { taskId } = job.data as { taskId: string };
      await this.markFailedSafely(taskId, err);
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} stalled — will be retried by BullMQ`);
  }
}
```

- [ ] **Step 8: 注册 processor**

`apps/api/src/modules/tasks/tasks.module.ts`，import 区加：

```ts
import { AiImageProcessor } from './processors/ai-image.processor';
```

`providers` 数组在 `FontProcessor` 之后加：

```ts
    AiImageProcessor,
```

- [ ] **Step 9: 运行测试确认通过**

```bash
bun --cwd apps/api test src/modules/tasks
```

预期：全部 PASS。

注意 Step 5 的 spec 里 `markGeneratedImage` 被 mock 成透传，所以 `filesService.upload`
收到的 buffer 与 provider 返回的一致；真实运行时会是写过 EXIF 的新 buffer。

- [ ] **Step 10: 提交**

```bash
git add apps/api/src/modules/tasks
git commit -m "feat(tasks): 新增 AI 生图 processor 与生成内容隐式标识"
```

---

## Task 9: 重新导出 OpenAPI 与 api-client

`packages/api-client/src/schema.ts`
是生成物，任务类型枚举变了必须重新生成，否则前端类型与后端不一致，`release:verify` 的漂移检查会红。

**Files:**

- Modify: `apps/api/openapi.json`（生成物）
- Modify: `packages/api-client/src/schema.ts`（生成物）

- [ ] **Step 1: 导出 OpenAPI**

```bash
cd apps/api && bun run openapi:export
```

- [ ] **Step 2: 生成 client 类型**

```bash
cd packages/api-client && bun run generate
```

- [ ] **Step 3: 确认生成物包含新枚举值**

```bash
grep -c "image_generate" packages/api-client/src/schema.ts
```

预期：输出大于 0（`CreateTaskDto.type` 与任务响应的枚举都会出现）。

- [ ] **Step 4: 跑 packages 测试**

```bash
bun test packages/api-client/src
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/openapi.json packages/api-client/src/schema.ts
git commit -m "chore(api-client): 重新生成 OpenAPI 与 client 类型以包含 image_generate"
```

---

## Task 10: 工具元数据与中英文文案

**Files:**

- Modify: `apps/web/src/lib/tools/tool-metadata.ts:1-22,52-208`
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`
- Test: `apps/web/src/components/tools/__tests__/tool-metadata.test.ts:45-47`

- [ ] **Step 1: 改测试期望——图片工具数量**

`apps/web/src/components/tools/__tests__/tool-metadata.test.ts`：

```ts
it('does not leave the image catalog under-explained', () => {
  expect(imageToolGroups.flatMap(group => group.tools)).toHaveLength(12);
});
```

再追加一个用例，锁住这个工具的服务端 + 强制登录属性：

```ts
it('registers the AI image generator as a login-gated server tool', () => {
  const tool = getToolByHref('/image/generate');

  expect(tool?.key).toBe('imageGenerate');
  expect(tool?.processing).toBe('server');
  expect(tool?.requiresLogin).toBe(true);
  expect(tool?.retention).toBe('account-files');
});
```

新工具**不要**设 `recommended: true`。`recommendedTools` 被 `tool-experience.test.tsx:71-81`
的网格填充用例当作固定长度 11 的样本使用（`recommendedTools = allTools.filter(tool => tool.recommended)`，`tool-metadata.ts:393`），设了就会连带改那个测试的算术期望。

- [ ] **Step 2: 运行测试确认失败**

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-metadata.test.ts
```

预期：两个用例 FAIL。

- [ ] **Step 3: 加工具元数据**

`apps/web/src/lib/tools/tool-metadata.ts`，lucide import 加 `Sparkles`（保持字母序，在 `Scissors`
之后）：

```ts
  Scissors,
  Sparkles,
  Stamp,
```

`imageTools` 数组末尾追加条目：

```ts
  {
    key: 'imageGenerate',
    href: '/image/generate',
    icon: Sparkles,
    titleKey: 'ToolCatalog.tools.imageGenerate.title',
    descriptionKey: 'ToolCatalog.tools.imageGenerate.description',
    categoryKey: 'ToolCatalog.categories.imageGenerate',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    limitKeys: ['aiImage.dailyCount'],
    tags: ['ai', 'generate', 'prompt'],
  },
```

- [ ] **Step 4: 加中文文案**

`apps/web/messages/zh.json`。`ToolCatalog.categories` 加成对的两项（`groupByCategory` 硬依赖
`<key>` + `<key>Description` 命名，`tool-metadata.ts:378-387`）：

```json
    "imageGenerate": "AI 生图",
    "imageGenerateDescription": "用文字描述生成图片，产物直接进账号文件。",
```

`ToolCatalog.tools` 加一项：

```json
    "imageGenerate": {
      "title": "AI 生图",
      "description": "输入提示词生成图片，需要登录，每日有张数上限。"
    },
```

`TasksTool.typeImageGenerate` 已在 Task 1 加过，此处跳过。

顶层加新命名空间 `ImageGenerate`：

```json
  "ImageGenerate": {
    "title": "AI 生图",
    "description": "用文字描述生成图片。服务端处理，需要登录，产物保存到账号文件。",
    "promptLabel": "提示词",
    "promptPlaceholder": "描述你想要的画面，越具体越好",
    "promptHint": "最多 2000 字",
    "sizeLabel": "尺寸",
    "sizes": {
      "1024x1024": "正方形 1:1",
      "1024x1536": "竖版 2:3",
      "1536x1024": "横版 3:2"
    },
    "qualityLabel": "质量",
    "qualities": {
      "standard": "标准",
      "high": "高"
    },
    "styleLabel": "风格",
    "styles": {
      "none": "不指定",
      "photographic": "写实摄影",
      "illustration": "插画",
      "anime": "动漫",
      "three_d": "3D 渲染",
      "watercolor": "水彩",
      "line_art": "线稿"
    },
    "countLabel": "生成数量",
    "submit": "开始生成",
    "generating": "生成中",
    "resultTitle": "生成结果",
    "resultMeta": "第 {index} 张",
    "quotaExceeded": "今日额度已用完，明天再来。",
    "contentRejected": "提示词被内容策略拒绝，换个说法再试。",
    "notConfigured": "AI 生图尚未配置，请联系管理员。",
    "failed": "生成失败，请重试。"
  },
```

- [ ] **Step 5: 加英文文案**

`apps/web/messages/en.json`，同结构：

```json
    "imageGenerate": "AI image generation",
    "imageGenerateDescription": "Generate images from a text prompt, saved straight to your account files.",
```

```json
    "imageGenerate": {
      "title": "AI image generation",
      "description": "Generate images from a prompt. Sign-in required, with a daily image cap."
    },
```

`TasksTool.typeImageGenerate` 已在 Task 1 加过，此处跳过。

```json
  "ImageGenerate": {
    "title": "AI image generation",
    "description": "Generate images from a text prompt. Processed on the server, sign-in required, results saved to your account files.",
    "promptLabel": "Prompt",
    "promptPlaceholder": "Describe the image you want — the more specific, the better",
    "promptHint": "Up to 2000 characters",
    "sizeLabel": "Size",
    "sizes": {
      "1024x1024": "Square 1:1",
      "1024x1536": "Portrait 2:3",
      "1536x1024": "Landscape 3:2"
    },
    "qualityLabel": "Quality",
    "qualities": {
      "standard": "Standard",
      "high": "High"
    },
    "styleLabel": "Style",
    "styles": {
      "none": "Unspecified",
      "photographic": "Photographic",
      "illustration": "Illustration",
      "anime": "Anime",
      "three_d": "3D render",
      "watercolor": "Watercolor",
      "line_art": "Line art"
    },
    "countLabel": "Number of images",
    "submit": "Generate",
    "generating": "Generating",
    "resultTitle": "Results",
    "resultMeta": "Image {index}",
    "quotaExceeded": "You have used today's quota. Try again tomorrow.",
    "contentRejected": "The prompt was rejected by the content policy. Try rephrasing it.",
    "notConfigured": "AI image generation is not configured. Contact the administrator.",
    "failed": "Generation failed. Please try again."
  },
```

- [ ] **Step 6: 运行测试确认通过**

```bash
bun --cwd apps/web test src/components/tools src/lib/tools src/app/sitemap.test.ts
```

预期：全部 PASS。`tool-route-metadata.test.ts` 会遍历 `allTools`
校验 titleKey/descriptionKey 引用链，`sitemap.test.ts` 由 `allTools` 驱动，两者都应自动通过。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/lib/tools apps/web/src/components/tools apps/web/messages
git commit -m "feat(web): 注册 AI 生图工具元数据与中英文文案"
```

---

## Task 11: useTaskGroupProgress 批量轮询 hook

一次生成 N 张 = N 个任务。`useTaskProgress` 只接单个 taskId，而 React
Hook 不能按可变长度循环调用，所以用**一个** query 在单次 `queryFn` 里并发取 N 个状态。

**Files:**

- Create: `apps/web/src/hooks/api/use-task-group-progress.ts`
- Create: `apps/web/src/hooks/api/__tests__/use-task-group-progress.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/hooks/api/__tests__/use-task-group-progress.test.ts`：

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useTaskGroupProgress } from '../use-task-group-progress';

vi.mock('@/lib/api-client', () => ({
  api: {
    GET: vi.fn(),
  },
}));

import { api } from '@/lib/api-client';
const mockGet = vi.mocked(api.GET);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function statusFor(id: string) {
  if (id === 'task-1') {
    return { status: 'completed', progress: 100, outputFileId: 'file-1' };
  }
  return {
    status: 'failed',
    progress: 0,
    errorCode: 'AI_IMAGE_GENERATION_FAILED',
    errorMessage: 'Image generation failed',
  };
}

describe('useTaskGroupProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch for an empty id list', () => {
    renderHook(() => useTaskGroupProgress([]), { wrapper: createWrapper() });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns one item per task id, keyed in input order', async () => {
    mockGet.mockImplementation((async (_path: string, init: any) => ({
      data: statusFor(init.params.path.id),
      error: undefined,
    })) as any);

    const { result } = renderHook(
      () => useTaskGroupProgress(['task-1', 'task-2'], { pollingInterval: 100 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.items).toHaveLength(2), {
      timeout: 3000,
    });
    expect(result.current.items.map(item => item.taskId)).toEqual(['task-1', 'task-2']);
    expect(result.current.completedCount).toBe(1);
    expect(result.current.failedCount).toBe(1);
    expect(result.current.settled).toBe(true);
  });

  it('stops polling once every task reaches a terminal state', async () => {
    mockGet.mockImplementation((async (_path: string, init: any) => ({
      data: statusFor(init.params.path.id),
      error: undefined,
    })) as any);

    const { result } = renderHook(
      () => useTaskGroupProgress(['task-1', 'task-2'], { pollingInterval: 100 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.settled).toBe(true), {
      timeout: 3000,
    });

    const callCount = mockGet.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(mockGet.mock.calls.length).toBe(callCount);
  });

  it('reports each terminal task exactly once', async () => {
    const onItemCompleted = vi.fn();
    const onItemFailed = vi.fn();
    mockGet.mockImplementation((async (_path: string, init: any) => ({
      data: statusFor(init.params.path.id),
      error: undefined,
    })) as any);

    renderHook(
      () =>
        useTaskGroupProgress(['task-1', 'task-2'], {
          pollingInterval: 100,
          onItemCompleted,
          onItemFailed,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(onItemCompleted).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(onItemCompleted).toHaveBeenCalledWith('task-1', 'file-1');
    expect(onItemFailed).toHaveBeenCalledTimes(1);
    expect(onItemFailed).toHaveBeenCalledWith('task-2', {
      code: 'AI_IMAGE_GENERATION_FAILED',
      message: 'Image generation failed',
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun --cwd apps/web test src/hooks/api/__tests__/use-task-group-progress.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 hook**

新建 `apps/web/src/hooks/api/use-task-group-progress.ts`：

```ts
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { TaskStatusDto } from './types';

export interface TaskGroupProgressItem extends TaskStatusDto {
  taskId: string;
}

export interface UseTaskGroupProgressOptions {
  pollingInterval?: number;
  onItemCompleted?: (taskId: string, outputFileId: string) => void;
  onItemFailed?: (taskId: string, error: { code: string; message: string }) => void;
}

function isTerminal(status: TaskStatusDto['status']): boolean {
  return status === 'completed' || status === 'failed';
}

/**
 * 同时轮询多个任务的状态。
 *
 * 用单个 query 而不是 N 个 useTaskProgress:Hook 不能按可变长度循环调用。
 * 全部任务进入终态后停止轮询,每个任务的终态回调只触发一次。
 */
export function useTaskGroupProgress(taskIds: string[], options?: UseTaskGroupProgressOptions) {
  const interval = options?.pollingInterval ?? 1000;
  const onItemCompleted = options?.onItemCompleted;
  const onItemFailed = options?.onItemFailed;
  const groupKey = taskIds.join(',');
  const reportedRef = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['task-group-progress', groupKey],
    queryFn: async () =>
      Promise.all(
        taskIds.map(async taskId => {
          const { data, error } = await api.GET('/tasks/{id}/status', {
            params: { path: { id: taskId } },
          });
          if (error) throw error;
          return { taskId, ...(data as TaskStatusDto) };
        })
      ),
    enabled: taskIds.length > 0,
    refetchInterval: q => {
      const items = q.state.data;
      if (items && items.every(item => isTerminal(item.status))) return false;
      return interval;
    },
    refetchIntervalInBackground: false,
  });

  const items = useMemo<TaskGroupProgressItem[]>(() => query.data ?? [], [query.data]);

  useEffect(() => {
    reportedRef.current = new Set();
  }, [groupKey]);

  useEffect(() => {
    for (const item of items) {
      if (!isTerminal(item.status) || reportedRef.current.has(item.taskId)) {
        continue;
      }
      reportedRef.current.add(item.taskId);

      if (item.status === 'completed') {
        onItemCompleted?.(item.taskId, item.outputFileId ?? '');
      } else {
        onItemFailed?.(item.taskId, {
          code: item.errorCode ?? 'UNKNOWN',
          message: item.errorMessage ?? 'Task failed',
        });
      }
    }
  }, [items, onItemCompleted, onItemFailed]);

  return {
    items,
    completedCount: items.filter(item => item.status === 'completed').length,
    failedCount: items.filter(item => item.status === 'failed').length,
    settled: items.length > 0 && items.every(item => isTerminal(item.status)),
    query,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun --cwd apps/web test src/hooks/api
```

预期：全部 PASS（含既有 `use-task-progress.test.ts`）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/hooks/api
git commit -m "feat(web): 新增多任务批量轮询 hook"
```

---

## Task 12: ImageGenerateOptions 参数表单组件

**Files:**

- Create: `apps/web/src/components/tools/image-generate-options.tsx`
- Create: `apps/web/src/components/tools/__tests__/image-generate-options.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/web/src/components/tools/__tests__/image-generate-options.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { ImageGenerateOptions, type ImageGenerateDraft } from '../image-generate-options';

const draft: ImageGenerateDraft = {
  prompt: '',
  size: '1024x1024',
  quality: 'high',
  count: 1,
};

function renderOptions(value: ImageGenerateDraft = draft, onChange = vi.fn(), disabled = false) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ImageGenerateOptions value={value} onChange={onChange} disabled={disabled} />
    </NextIntlClientProvider>
  );
  return { onChange };
}

describe('ImageGenerateOptions', () => {
  it('renders a labelled prompt field', () => {
    renderOptions();
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
  });

  it('reports prompt edits', async () => {
    const { onChange } = renderOptions();

    await userEvent.type(screen.getByLabelText('Prompt'), 'a');

    expect(onChange).toHaveBeenCalledWith({ ...draft, prompt: 'a' });
  });

  it('reports the selected size', async () => {
    const { onChange } = renderOptions();

    await userEvent.click(screen.getByRole('radio', { name: 'Portrait 2:3' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, size: '1024x1536' });
  });

  it('reports the selected style and allows clearing it', async () => {
    const { onChange } = renderOptions({ ...draft, style: 'anime' });

    await userEvent.click(screen.getByRole('radio', { name: 'Unspecified' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, style: undefined });
  });

  it('reports the requested image count', async () => {
    const { onChange } = renderOptions();

    await userEvent.click(screen.getByRole('radio', { name: '4' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, count: 4 });
  });

  it('disables every control while a generation is running', () => {
    renderOptions(draft, vi.fn(), true);

    expect(screen.getByLabelText('Prompt')).toBeDisabled();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
bun --cwd apps/web test src/components/tools/__tests__/image-generate-options.test.tsx
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现组件（第一部分：类型与选项常量）**

新建 `apps/web/src/components/tools/image-generate-options.tsx`：

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type {
  ImageGenerateQuality,
  ImageGenerateSize,
  ImageGenerateStyle,
} from '@utils-plane/validators';

export interface ImageGenerateDraft {
  prompt: string;
  size: ImageGenerateSize;
  quality: ImageGenerateQuality;
  style?: ImageGenerateStyle;
  count: number;
}

const SIZES: ImageGenerateSize[] = ['1024x1024', '1024x1536', '1536x1024'];
const QUALITIES: ImageGenerateQuality[] = ['standard', 'high'];
const STYLES: ImageGenerateStyle[] = [
  'photographic',
  'illustration',
  'anime',
  'three_d',
  'watercolor',
  'line_art',
];
const COUNTS = [1, 2, 4];

export const IMAGE_GENERATE_PROMPT_MAX_LENGTH = 2000;

interface ImageGenerateOptionsProps {
  value: ImageGenerateDraft;
  onChange: (next: ImageGenerateDraft) => void;
  disabled?: boolean;
}

interface RadioRowProps<T extends string | number> {
  name: string;
  legend: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  disabled: boolean;
  onSelect: (value: T) => void;
}

function RadioRow<T extends string | number>({
  name,
  legend,
  options,
  selected,
  disabled,
  onSelect,
}: RadioRowProps<T>) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <label
            key={String(option.value)}
            className="cursor-pointer rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              value={String(option.value)}
              checked={selected === option.value}
              disabled={disabled}
              onChange={() => onSelect(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: 实现组件（第二部分：主体）**

追加到同一文件：

```tsx
export function ImageGenerateOptions({
  value,
  onChange,
  disabled = false,
}: ImageGenerateOptionsProps) {
  const t = useTranslations('ImageGenerate');

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="image-generate-prompt" className="text-sm font-medium">
          {t('promptLabel')}
        </label>
        <textarea
          id="image-generate-prompt"
          className="min-h-28 w-full rounded-md border bg-background p-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          maxLength={IMAGE_GENERATE_PROMPT_MAX_LENGTH}
          placeholder={t('promptPlaceholder')}
          value={value.prompt}
          disabled={disabled}
          onChange={event => onChange({ ...value, prompt: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('promptHint')}</p>
      </div>

      <RadioRow
        name="image-generate-size"
        legend={t('sizeLabel')}
        selected={value.size}
        disabled={disabled}
        options={SIZES.map(size => ({ value: size, label: t(`sizes.${size}`) }))}
        onSelect={size => onChange({ ...value, size })}
      />

      <RadioRow
        name="image-generate-quality"
        legend={t('qualityLabel')}
        selected={value.quality}
        disabled={disabled}
        options={QUALITIES.map(quality => ({
          value: quality,
          label: t(`qualities.${quality}`),
        }))}
        onSelect={quality => onChange({ ...value, quality })}
      />

      <RadioRow
        name="image-generate-style"
        legend={t('styleLabel')}
        selected={value.style ?? 'none'}
        disabled={disabled}
        options={[
          { value: 'none' as const, label: t('styles.none') },
          ...STYLES.map(style => ({
            value: style,
            label: t(`styles.${style}`),
          })),
        ]}
        onSelect={style =>
          onChange({
            ...value,
            style: style === 'none' ? undefined : (style as ImageGenerateStyle),
          })
        }
      />

      <RadioRow
        name="image-generate-count"
        legend={t('countLabel')}
        selected={value.count}
        disabled={disabled}
        options={COUNTS.map(count => ({ value: count, label: String(count) }))}
        onSelect={count => onChange({ ...value, count })}
      />
    </div>
  );
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
bun --cwd apps/web test src/components/tools/__tests__/image-generate-options.test.tsx
```

预期：全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/tools
git commit -m "feat(web): 新增 AI 生图参数表单组件"
```

---

## Task 13: /image/generate 页面

**Files:**

- Create: `apps/web/src/app/[locale]/(app)/image/generate/layout.tsx`
- Create: `apps/web/src/app/[locale]/(app)/image/generate/page.tsx`
- Create: `apps/web/src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx`

- [ ] **Step 1: 建 layout**

新建 `apps/web/src/app/[locale]/(app)/image/generate/layout.tsx`：

```tsx
import { createToolMetadataGenerator, ToolMetadataLayout } from '@/lib/tools/tool-route-metadata';

export const generateMetadata = createToolMetadataGenerator('/image/generate');

export default ToolMetadataLayout;
```

- [ ] **Step 2: 写失败测试**

新建 `apps/web/src/app/[locale]/(app)/image/generate/__tests__/page.test.tsx`：

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../../messages/en.json';
import ImageGeneratePage from '../page';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  createTask: vi.fn(),
  push: vi.fn(),
  groupProgress: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => mocks.useSession() },
}));

vi.mock('@/hooks/api/use-tasks', () => ({
  useCreateTask: () => ({ mutateAsync: mocks.createTask }),
}));

vi.mock('@/hooks/api/use-task-group-progress', () => ({
  useTaskGroupProgress: () => mocks.groupProgress(),
}));

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ImageGeneratePage />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useSession.mockReturnValue({ data: { user: { id: 'user-1' } } });
  mocks.groupProgress.mockReturnValue({
    items: [],
    completedCount: 0,
    failedCount: 0,
    settled: false,
  });
  mocks.createTask.mockImplementation(async () => ({ id: 'task-1' }));
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:preview-url'),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

describe('ImageGeneratePage', () => {
  it('redirects an anonymous visitor to login instead of creating tasks', async () => {
    mocks.useSession.mockReturnValue({ data: null });
    renderPage();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent('/image/generate')}`
      )
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled until a prompt is entered', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('creates one task per requested image with an empty input file list', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(2));
    expect(mocks.createTask).toHaveBeenCalledWith({
      type: 'image_generate',
      inputFileIds: [],
      inputConfig: {
        mode: 'text_to_image',
        prompt: 'a shiba inu',
        size: '1024x1024',
        quality: 'high',
      },
    });
  });

  it('surfaces the daily quota error without creating more tasks', async () => {
    mocks.createTask.mockRejectedValue({
      code: 'AI_IMAGE_DAILY_LIMIT_EXCEEDED',
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(
        screen.getByText("You have used today's quota. Try again tomorrow.")
      ).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
bun --cwd apps/web test "src/app/[locale]/(app)/image/generate"
```

预期：FAIL，页面不存在。（Windows PowerShell 下路径含 `[locale]` 与 `(app)`，务必加引号，见
`AGENTS.md` 注意事项第 4 条。）

- [ ] **Step 4: 实现页面（第一部分：状态与提交）**

新建 `apps/web/src/app/[locale]/(app)/image/generate/page.tsx`：

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskGroupProgress } from '@/hooks/api/use-task-group-progress';
import {
  ImageGenerateOptions,
  type ImageGenerateDraft,
} from '@/components/tools/image-generate-options';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import type { ToolStage } from '@/components/tools/tool-step-rail';

const TOOL_HREF = '/image/generate';

const ERROR_MESSAGE_KEY: Record<string, string> = {
  AI_IMAGE_DAILY_LIMIT_EXCEEDED: 'quotaExceeded',
  AI_IMAGE_CONTENT_REJECTED: 'contentRejected',
  AI_IMAGE_NOT_CONFIGURED: 'notConfigured',
};

const INITIAL_DRAFT: ImageGenerateDraft = {
  prompt: '',
  size: '1024x1024',
  quality: 'high',
  count: 1,
};

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'AI_IMAGE_GENERATION_FAILED';
}

export default function ImageGeneratePage() {
  const t = useTranslations('ImageGenerate');
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const createTask = useCreateTask();

  const [draft, setDraft] = useState<ImageGenerateDraft>(INITIAL_DRAFT);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const loadPreview = useCallback(async (taskId: string, fileId: string) => {
    if (!fileId) return;
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/files/${fileId}/download`,
      { credentials: 'include' }
    );
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    setPreviews(current => ({ ...current, [taskId]: url }));
  }, []);

  const { items, settled } = useTaskGroupProgress(taskIds, {
    onItemCompleted: loadPreview,
  });

  useEffect(
    () => () => {
      for (const url of Object.values(previews)) URL.revokeObjectURL(url);
    },
    [previews]
  );

  const reset = () => {
    setTaskIds([]);
    setErrorCode(null);
    setPreviews({});
  };

  const submit = async () => {
    if (!session) {
      router.push(`/login?next=${encodeURIComponent(TOOL_HREF)}`);
      return;
    }

    reset();
    setSubmitting(true);

    const created: string[] = [];
    let failureCode: string | null = null;

    for (let index = 0; index < draft.count; index += 1) {
      try {
        const task = await createTask.mutateAsync({
          type: 'image_generate',
          inputFileIds: [],
          inputConfig: {
            mode: 'text_to_image',
            prompt: draft.prompt.trim(),
            size: draft.size,
            quality: draft.quality,
            ...(draft.style ? { style: draft.style } : {}),
          },
        });
        created.push(task.id);
      } catch (error) {
        // 部分超额不整批回滚:已建出的任务继续跑,剩下的报错。
        failureCode = errorCodeOf(error);
        break;
      }
    }

    setTaskIds(created);
    setErrorCode(failureCode);
    setSubmitting(false);
  };
```

- [ ] **Step 5: 实现页面（第二部分：渲染）**

接着同一个函数体，追加渲染部分：

```tsx
  const stage: ToolStage = submitting
    ? 'processing'
    : taskIds.length === 0
      ? 'configure'
      : settled
        ? 'result'
        : 'processing';

  const averageProgress =
    items.length > 0
      ? items.reduce((sum, item) => sum + (item.progress ?? 0), 0) /
        items.length
      : 0;

  const errorMessageKey = errorCode
    ? (ERROR_MESSAGE_KEY[errorCode] ?? 'failed')
    : null;

  return (
    <ToolPageShell
      title={t('title')}
      description={t('description')}
      processing="server"
      retention="account-files"
      requiresLogin
      recovery={t('failed')}
      stage={stage}
    >
      <ImageGenerateOptions
        value={draft}
        onChange={setDraft}
        disabled={submitting || (taskIds.length > 0 && !settled)}
      />

      <button
        type="button"
        className="rounded-md border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        disabled={
          draft.prompt.trim().length === 0 ||
          submitting ||
          (taskIds.length > 0 && !settled)
        }
        onClick={submit}
      >
        {submitting || (taskIds.length > 0 && !settled)
          ? t('generating')
          : t('submit')}
      </button>

      {errorMessageKey && (
        <FailureRecoveryPanel
          message={t(errorMessageKey)}
          errorCode={errorCode ?? undefined}
          onRetry={submit}
        />
      )}

      {taskIds.length > 0 && !settled && (
        <ProcessingProgress progress={averageProgress} stage="generating" />
      )}

      {items.map((item, index) => {
        if (item.status === 'failed') {
          return (
            <FailureRecoveryPanel
              key={item.taskId}
              message={t(ERROR_MESSAGE_KEY[item.errorCode ?? ''] ?? 'failed')}
              errorCode={item.errorCode}
              onRetry={submit}
            />
          );
        }
        if (item.status !== 'completed') return null;

        const previewUrl = previews[item.taskId];
        return (
          <ResultPanel
            key={item.taskId}
            title={t('resultTitle')}
            description={t('resultMeta', { index: index + 1 })}
            preview={
              previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={t('resultMeta', { index: index + 1 })}
                  className="max-h-96 w-auto rounded-md"
                />
              ) : undefined
            }
            action={
              previewUrl ? (
                <a
                  href={previewUrl}
                  download={`ai-image-${index + 1}.png`}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  {t('resultTitle')}
                </a>
              ) : null
            }
          />
        );
      })}
    </ToolPageShell>
  );
}
```

- [ ] **Step 6: 运行测试确认通过**

```bash
bun --cwd apps/web test "src/app/[locale]/(app)/image/generate"
```

预期：全部 PASS。

- [ ] **Step 7: 跑全量 web 测试确认无回归**

```bash
bun --cwd apps/web test -- --exclude "e2e/**"
```

预期：全部 PASS。`catalog-pages.test.tsx` 会渲染图片工具目录页，新条目应自动出现。

- [ ] **Step 8: 提交**

```bash
git add "apps/web/src/app/[locale]/(app)/image/generate"
git commit -m "feat(web): 新增 AI 生图页面"
```

---

## Task 14: 中英文文案 key 一致性测试

仓库当前没有任何 `zh.json` / `en.json`
的 key 比对，漏文案不会被任何测试抓到。本次新增了一整个命名空间，顺手补上这道护栏。

已核对：两个文件当前各 1029 个 key，完全对齐。所以这个测试落地即应为绿——它防的是未来的漂移。

**Files:**

- Create: `apps/web/src/__tests__/messages-parity.test.ts`

- [ ] **Step 1: 写测试**

新建 `apps/web/src/__tests__/messages-parity.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe('message catalogues', () => {
  const zhKeys = flattenKeys(zh).sort();
  const enKeys = flattenKeys(en).sort();

  it('keeps zh and en in structural parity', () => {
    expect(zhKeys).toEqual(enKeys);
  });

  it('carries the AI image generation namespace in both locales', () => {
    for (const keys of [zhKeys, enKeys]) {
      expect(keys).toContain('ImageGenerate.promptLabel');
      expect(keys).toContain('ImageGenerate.quotaExceeded');
      expect(keys).toContain('ToolCatalog.tools.imageGenerate.title');
      expect(keys).toContain('ToolCatalog.categories.imageGenerate');
      expect(keys).toContain('ToolCatalog.categories.imageGenerateDescription');
      expect(keys).toContain('TasksTool.typeImageGenerate');
    }
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

```bash
bun --cwd apps/web test src/__tests__/messages-parity.test.ts
```

预期：PASS。若第一个用例红了，说明 Task 10 只改了一个语言文件，回去补齐。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/__tests__/messages-parity.test.ts
git commit -m "test(web): 新增中英文文案 key 一致性校验"
```

---

## Task 15: 环境变量、部署配置与文档

`docker-compose.prod.yml` 的 api service 当前连 `ID_PHOTO_AI_*` 都没有透传。新的 `AI_IMAGE_*`
不显式加进去，生产会静默降级成「未配置」而本地一切正常——这是最容易漏且最难察觉的一处。

**Files:**

- Modify: `.env.example`
- Modify: `docker-compose.prod.yml`
- Modify: `CLAUDE.md`
- Modify: `PROJECT_SPECS.md`
- Modify: `README.md`

- [ ] **Step 1: `.env.example` 加配置段**

在现有 `ID_PHOTO_AI_*` 段之后追加：

```env
AI_IMAGE_BASE_URL=
AI_IMAGE_API_KEY=
AI_IMAGE_MODEL=gpt-image-1
AI_IMAGE_SIZE=1024x1024
AI_IMAGE_QUALITY=high
AI_IMAGE_RESPONSE_FORMAT=b64_json
```

- [ ] **Step 2: 生产 compose 透传环境变量**

`docker-compose.prod.yml` 的 api service `environment`
段，补上生图与抠图两组（抠图那组是既有遗漏，一并补齐）：

```yaml
- ID_PHOTO_AI_SEGMENTATION_BASE_URL=${ID_PHOTO_AI_SEGMENTATION_BASE_URL:-}
- ID_PHOTO_AI_SEGMENTATION_API_KEY=${ID_PHOTO_AI_SEGMENTATION_API_KEY:-}
- ID_PHOTO_AI_SEGMENTATION_MODEL=${ID_PHOTO_AI_SEGMENTATION_MODEL:-}
- AI_IMAGE_BASE_URL=${AI_IMAGE_BASE_URL:-}
- AI_IMAGE_API_KEY=${AI_IMAGE_API_KEY:-}
- AI_IMAGE_MODEL=${AI_IMAGE_MODEL:-gpt-image-1}
- AI_IMAGE_SIZE=${AI_IMAGE_SIZE:-1024x1024}
- AI_IMAGE_QUALITY=${AI_IMAGE_QUALITY:-high}
- AI_IMAGE_RESPONSE_FORMAT=${AI_IMAGE_RESPONSE_FORMAT:-b64_json}
```

- [ ] **Step 3: 验证 compose 配置可解析**

```bash
docker compose -f docker-compose.prod.yml config > /dev/null
```

预期：无输出、退出码 0。有语法错误会直接报出来。

- [ ] **Step 4: 更新 CLAUDE.md**

四处：

1. 前端路由列表的图片行，在 `/image/mosaic` 之后加 `/image/generate`
2. 「当前工具处理边界」加一条：`AI 生图（/image/generate）走服务端任务，必须登录，受每日张数配额限制；产物写入隐式来源标识，不加可见水印；当前只支持文生图。`
3. 「当前任务类型包含」列表末尾加 `image_generate`
4. 环境变量段加上 Step 1 的 `AI_IMAGE_*` 六行

- [ ] **Step 5: 更新 PROJECT_SPECS.md 与 README.md**

`PROJECT_SPECS.md` 的任务类型全列表末尾加 `image_generate`。

`README.md` 工具列表加一行：

```text
- AI 生图（/image/generate）：文字描述生成图片，需要登录，每日限张数。
```

`README.md` 的 AI 配置说明章节加一节：

```markdown
### AI 生图

AI 生图使用独立的 OpenAI 兼容配置，与证件照 AI 抠图互不影响：

- `AI_IMAGE_BASE_URL`：OpenAI 兼容网关地址，未设置时 `/image/generate` 入口隐藏。
- `AI_IMAGE_API_KEY`：网关鉴权 key。
- `AI_IMAGE_MODEL`：模型名，默认 `gpt-image-1`。
- `AI_IMAGE_SIZE`、`AI_IMAGE_QUALITY`、`AI_IMAGE_RESPONSE_FORMAT`：默认生成参数。

当前只实现文生图，走 `POST /v1/images/generations`。图生图与局部重绘尚未实现。每日生成张数上限在
`packages/utils/src/entitlements.ts` 的 `LIMITS['aiImage.dailyCount']` 中按 plan 配置。
```

- [ ] **Step 6: 格式检查**

```bash
bun run format:check:changed
```

预期：PASS。不通过就跑 `bun run format` 再提交。

- [ ] **Step 7: 提交**

```bash
git add .env.example docker-compose.prod.yml CLAUDE.md PROJECT_SPECS.md README.md
git commit -m "docs(ai-image): 补充 AI 生图环境变量、生产透传与文档"
```

---

## Task 16: 端到端验证与发布前检查

**Files:** 无（仅验证）

- [ ] **Step 1: 配好本地 provider**

在 `.env.local` 里填入实测可用的 `AI_IMAGE_BASE_URL` 与 `AI_IMAGE_API_KEY`。

- [ ] **Step 2: 起服务**

```bash
bun run services:up
```

分别在两个终端：

```bash
cd apps/api && bun run dev
```

```bash
cd apps/web && bun run dev
```

- [ ] **Step 3: 手动走一遍**

浏览器打开 http://localhost:3000/zh/image/generate ，逐项确认：

1. 未登录点「开始生成」→ 跳到 `/zh/login?next=%2Fimage%2Fgenerate`
2. 登录后填提示词、选 2 张、生成 → 任务列表 `/zh/tasks` 出现两条「AI 生图」记录
3. 两张图逐张出现（不是等全部完成才一起出）
4. 产物出现在 `/zh/files`，归属当前账号
5. 把 `aiImage.dailyCount` 的 `signed_in`
   临时改成 1，再生成 2 张 → 第一张成功、第二张报「今日额度已用完」，改回去
6. 故意填一个会被 provider 拒的提示词 → 页面显示内容策略文案，且 `/tasks/:id/status` 返回的
   `errorMessage` 里**没有**原 prompt

- [ ] **Step 4: 核对产物标识**

从 `/zh/files` 下载一张生成图，确认 EXIF 里有来源标识、没有 prompt：

```bash
bun -e "const sharp=require('sharp');sharp(process.argv[1]).metadata().then(m=>console.log(m.exif?.toString('latin1')))" <下载的图片路径>
```

预期：输出包含 `Utils-Plane AI Image Generation` 与 `model=`，不包含提示词内容。

- [ ] **Step 5: 截图留档**

按 `AGENTS.md` 的核对截图规范，把页面截图存到
`artifacts/screenshots/image-generate-*.png`（该目录不提交 Git）。

- [ ] **Step 6: 发布前检查**

先停掉占用 3000 端口的 web dev server，设置 `NEXT_PUBLIC_SUPPORT_EMAIL`，再跑：

```bash
bun run release:verify
```

预期：10 步全绿，含增量格式检查、lint、三类测试、OpenAPI 与 client 漂移检查、构建和 7 项 Playwright 测试。

- [ ] **Step 7: 若 release:verify 有改动产物则提交**

```bash
git status --short
```

有生成物变更就提交：

```bash
git add -A
git commit -m "chore(ai-image): release:verify 产物同步"
```

---

## 后续计划

1. **图生图**（`image_to_image`）：复用本计划的 provider 与 processor，加 `/v1/images/edits`
   调用路径与页面上传入口。`normalizeOpenAiCompatibleImageEditUrl` 已在共享模块里就位。
2. **局部重绘**（`inpaint`）：在图生图之上加 `mask` 参数与蒙版画笔组件，参考 `/image/mosaic`
   的 canvas 逻辑。这是三个模式里唯一没有现成参照的部件。
