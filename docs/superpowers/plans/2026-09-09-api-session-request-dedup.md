# 业务 API 会话请求去重实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除每次业务 API 请求前的 `getSession()` 调用和 Bearer Header 注入，让浏览器仅通过 HttpOnly Cookie 完成认证。

**Architecture:** 保留 OpenAPI 客户端自定义 fetch 中的 `credentials: 'include'`，删除认证请求中间件。NestJS `AuthGuard` 与 Better Auth 的数据库会话强校验保持不变，因此会话撤销语义不变，同时每次轮询减少一个 `get-session` 请求。

**Tech Stack:** TypeScript、openapi-fetch、Vitest、Next.js 14、Better Auth

---

## 文件结构

- Create: `apps/web/src/lib/__tests__/api-client.test.ts` — 锁定业务请求只使用 Cookie、不读取客户端 session、也不注入 Bearer Header的回归测试。
- Modify: `apps/web/src/lib/api-client.ts:1-20` — 删除 `authClient` 依赖和请求中间件，仅保留带 Cookie 的 fetch 配置。

### Task 1: 用测试锁定 Cookie-only 请求行为

**Files:**
- Create: `apps/web/src/lib/__tests__/api-client.test.ts`
- Test: `apps/web/src/lib/__tests__/api-client.test.ts`

- [ ] **Step 1: 写入当前实现会失败的回归测试**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: mocks.getSession,
  },
}));

import { createApiClientInstance } from '../api-client';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({
    data: {
      session: { token: 'session-token' },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ status: 'ok' }, { status: 200 })
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createApiClientInstance', () => {
  it('sends business requests with cookies without resolving a session token', async () => {
    const client = createApiClientInstance('https://api.example.com');

    await client.GET('/health/live');

    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [request, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).headers.has('Authorization')).toBe(false);
    expect(init).toEqual(expect.objectContaining({ credentials: 'include' }));
  });
});
```

- [ ] **Step 2: 运行定向测试，确认它能捕获现有冗余调用**

Run:

```bash
bun --cwd apps/web test -- src/lib/__tests__/api-client.test.ts
```

Expected: FAIL，失败断言为 `mocks.getSession` 被调用一次，且当前请求包含 `Authorization`。

### Task 2: 删除业务请求的 session 中间件

**Files:**
- Modify: `apps/web/src/lib/api-client.ts:1-20`
- Test: `apps/web/src/lib/__tests__/api-client.test.ts`

- [ ] **Step 1: 将 API 客户端缩减为 Cookie-only 配置**

把 `apps/web/src/lib/api-client.ts` 的导入和 `createApiClientInstance` 改成：

```typescript
import createClient from 'openapi-fetch';
import type { paths } from '@utils-plane/api-client';

export function createApiClientInstance(baseUrl: string) {
  return createClient<paths>({
    baseUrl,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, credentials: 'include' }),
  });
}
```

保留文件底部现有的 `api` 单例和 `ApiClient` 类型导出，不修改其内容。

- [ ] **Step 2: 运行定向测试，确认 Cookie-only 行为通过**

Run:

```bash
bun --cwd apps/web test -- src/lib/__tests__/api-client.test.ts
```

Expected: PASS；`getSession` 调用次数为 0，目标业务请求的 `credentials` 为 `include`，且没有 `Authorization` Header。

- [ ] **Step 3: 运行 Web 全量测试**

Run:

```bash
bun --cwd apps/web test
```

Expected: 所有 Vitest 测试通过，无失败用例。

- [ ] **Step 4: 运行 Web lint**

Run:

```bash
bun --cwd apps/web lint
```

Expected: 退出码 0，无 ESLint 错误。

- [ ] **Step 5: 运行 Web 生产构建**

Run:

```bash
bun --cwd apps/web build
```

Expected: 退出码 0，Next.js 编译、类型检查和静态页面生成全部成功。

- [ ] **Step 6: 检查最终差异并提交实现**

```bash
git diff --check
git diff -- apps/web/src/lib/api-client.ts apps/web/src/lib/__tests__/api-client.test.ts
git add -- apps/web/src/lib/api-client.ts apps/web/src/lib/__tests__/api-client.test.ts
git commit -m "fix(auth): 移除业务请求的重复会话查询" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Expected: `git diff --check` 无输出；提交只包含 API 客户端和对应测试。
