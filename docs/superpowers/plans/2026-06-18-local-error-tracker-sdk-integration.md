# 本地 Error Tracker SDK 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Utils-Plane 对本地 `@error-tracker/sdk` 的前后端环境变量接入，移除前端硬编码 token，并用测试保护初始化行为。

**Architecture:** Web 端继续使用 `ErrorTrackerInit` 客户端组件，在组件内从 public env 读取 DSN/token 并初始化 SDK。API 端新增一个纯 helper 构建 Node SDK options，`main.ts` 只负责读取 env、调用 helper 和初始化 SDK，避免测试导入启动服务器。环境变量文档同步补齐 frontend token。

**Tech Stack:** Next.js 14 App Router, React 18, Vitest, NestJS 11, Bun test, TypeScript, local `@error-tracker/sdk`.

---

## File Structure

- Modify: `apps/web/src/components/error-tracker-init.tsx`
  - 负责浏览器 SDK 初始化和 ReplayPlugin 配置，依赖 SDK 自动上报机制。
- Modify: `apps/web/src/components/__tests__/error-tracker-init.test.tsx`
  - 覆盖 DSN/token 初始化、DSN 缺失跳过初始化、StrictMode 下不重复初始化且不启动手动 flush 定时器。
- Create: `apps/api/src/config/error-tracker.config.ts`
  - 导出 `buildErrorTrackerOptions(env)` 纯函数，统一后端 SDK options 构建逻辑。
- Create: `apps/api/src/config/error-tracker.config.test.ts`
  - 用 Bun test 覆盖 helper 在 DSN/token/release 缺失或存在时的输出。
- Modify: `apps/api/src/main.ts`
  - 使用 `buildErrorTrackerOptions(process.env)`，有 options 时初始化 SDK。
- Modify: `.env.example`
  - 新增 `NEXT_PUBLIC_ERROR_TRACKER_TOKEN=`。
- Modify: `PROJECT_SPECS.md`
  - 前端环境变量示例补充 `NEXT_PUBLIC_ERROR_TRACKER_TOKEN=`。
- Modify: `CLAUDE.md`
  - 前端环境变量示例补充 `NEXT_PUBLIC_ERROR_TRACKER_TOKEN=`。

## Task 1: Web SDK Token Env

**Files:**
- Modify: `apps/web/src/components/__tests__/error-tracker-init.test.tsx`
- Modify: `apps/web/src/components/error-tracker-init.tsx`

- [ ] **Step 1: Write the failing web tests**

Update `apps/web/src/components/__tests__/error-tracker-init.test.tsx` so it contains these behaviors:

```tsx
import React, { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorTrackerInit } from '../error-tracker-init';
import { init } from '@error-tracker/sdk';

const mocks = vi.hoisted(() => {
  class ReplayPlugin {
    name = 'ReplayPlugin';
    constructor(public options: unknown) {}
  }
  return {
    client: {},
    replayPlugin: ReplayPlugin,
  };
});

vi.mock('@error-tracker/sdk', () => ({
  init: vi.fn(() => mocks.client),
}));

vi.mock('@error-tracker/sdk/plugins/replay', () => ({
  ReplayPlugin: mocks.replayPlugin,
}));

describe('ErrorTrackerInit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN =
      'http://localhost:3002/ingest/test-project';
    process.env.NEXT_PUBLIC_ERROR_TRACKER_TOKEN = 'test-token';
    process.env.NEXT_PUBLIC_RELEASE = 'test';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN;
    delete process.env.NEXT_PUBLIC_ERROR_TRACKER_TOKEN;
    delete process.env.NEXT_PUBLIC_RELEASE;
  });

  it('initializes the SDK with the configured DSN and token', () => {
    render(<ErrorTrackerInit />);

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'http://localhost:3002/ingest/test-project',
        token: 'test-token',
        release: 'test',
      })
    );
  });

  it('does not initialize when the DSN is missing', () => {
    delete process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN;

    render(<ErrorTrackerInit />);

    expect(init).not.toHaveBeenCalled();
  });

  it('does not start a manual flush timer under StrictMode', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    render(
      <StrictMode>
        <ErrorTrackerInit />
      </StrictMode>
    );

    expect(init).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run web test to verify it fails**

Run:

```bash
bun --cwd apps/web test src/components/__tests__/error-tracker-init.test.tsx
```

Expected: FAIL because `init` receives the existing hardcoded token instead of `process.env.NEXT_PUBLIC_ERROR_TRACKER_TOKEN`.

- [ ] **Step 3: Implement minimal web change**

Update `apps/web/src/components/error-tracker-init.tsx` so `init` receives the token from env:

```tsx
const token = process.env.NEXT_PUBLIC_ERROR_TRACKER_TOKEN;

init({
  dsn,
  ...(token ? { token } : {}),
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_RELEASE ?? 'dev',
  integrations: [
    new ReplayPlugin({ bufferSeconds: 30, sampleRate: 0.5 }),
  ],
});
```

- [ ] **Step 4: Run web test to verify it passes**

Run:

```bash
bun --cwd apps/web test src/components/__tests__/error-tracker-init.test.tsx
```

Expected: PASS.

## Task 2: API SDK Options Helper

**Files:**
- Create: `apps/api/src/config/error-tracker.config.ts`
- Create: `apps/api/src/config/error-tracker.config.test.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Write the failing API helper tests**

Create `apps/api/src/config/error-tracker.config.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { buildErrorTrackerOptions } from './error-tracker.config';

describe('buildErrorTrackerOptions', () => {
  it('returns null when ERROR_TRACKER_DSN is missing', () => {
    expect(buildErrorTrackerOptions({ NODE_ENV: 'test' })).toBeNull();
  });

  it('builds SDK options from backend environment variables', () => {
    expect(
      buildErrorTrackerOptions({
        ERROR_TRACKER_DSN: 'http://localhost:3002/ingest/api-project',
        ERROR_TRACKER_TOKEN: 'api-token',
        NODE_ENV: 'production',
        RELEASE: '2026.06.18',
        NEXT_PUBLIC_RELEASE: 'frontend-release',
      })
    ).toEqual({
      dsn: 'http://localhost:3002/ingest/api-project',
      token: 'api-token',
      environment: 'production',
      release: '2026.06.18',
    });
  });

  it('falls back to NEXT_PUBLIC_RELEASE and dev defaults', () => {
    expect(
      buildErrorTrackerOptions({
        ERROR_TRACKER_DSN: 'http://localhost:3002/ingest/api-project',
        NEXT_PUBLIC_RELEASE: 'shared-release',
      })
    ).toEqual({
      dsn: 'http://localhost:3002/ingest/api-project',
      environment: undefined,
      release: 'shared-release',
    });

    expect(
      buildErrorTrackerOptions({
        ERROR_TRACKER_DSN: 'http://localhost:3002/ingest/api-project',
      })
    ).toEqual({
      dsn: 'http://localhost:3002/ingest/api-project',
      environment: undefined,
      release: 'dev',
    });
  });
});
```

- [ ] **Step 2: Run API helper test to verify it fails**

Run:

```bash
bun test apps/api/src/config/error-tracker.config.test.ts
```

Expected: FAIL because `apps/api/src/config/error-tracker.config.ts` does not exist yet.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/config/error-tracker.config.ts`:

```ts
import type { SdkOptions } from '@error-tracker/sdk/node';

type ErrorTrackerEnv = Pick<
  NodeJS.ProcessEnv,
  | 'ERROR_TRACKER_DSN'
  | 'ERROR_TRACKER_TOKEN'
  | 'NODE_ENV'
  | 'RELEASE'
  | 'NEXT_PUBLIC_RELEASE'
>;

export function buildErrorTrackerOptions(
  env: ErrorTrackerEnv
): SdkOptions | null {
  if (!env.ERROR_TRACKER_DSN) {
    return null;
  }

  return {
    dsn: env.ERROR_TRACKER_DSN,
    ...(env.ERROR_TRACKER_TOKEN ? { token: env.ERROR_TRACKER_TOKEN } : {}),
    environment: env.NODE_ENV,
    release: env.RELEASE ?? env.NEXT_PUBLIC_RELEASE ?? 'dev',
  };
}
```

- [ ] **Step 4: Run API helper test to verify it passes**

Run:

```bash
bun test apps/api/src/config/error-tracker.config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire helper into API bootstrap**

Update `apps/api/src/main.ts`:

```ts
import { buildErrorTrackerOptions } from './config/error-tracker.config';

const errorTrackerOptions = buildErrorTrackerOptions(process.env);
if (errorTrackerOptions) {
  initErrorTracker(errorTrackerOptions);
}
```

Remove the old inline `if (process.env.ERROR_TRACKER_DSN) { ... }` block.

## Task 3: Environment Documentation

**Files:**
- Modify: `.env.example`
- Modify: `PROJECT_SPECS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add frontend token variable to env examples**

Add this line directly after `NEXT_PUBLIC_ERROR_TRACKER_DSN=` wherever frontend environment variables are listed:

```bash
NEXT_PUBLIC_ERROR_TRACKER_TOKEN=
```

- [ ] **Step 2: Verify docs contain both frontend and backend variables**

Run:

```bash
rg -n "NEXT_PUBLIC_ERROR_TRACKER_(DSN|TOKEN)|ERROR_TRACKER_(DSN|TOKEN)" .env.example PROJECT_SPECS.md CLAUDE.md
```

Expected: each doc source lists `NEXT_PUBLIC_ERROR_TRACKER_DSN`, `NEXT_PUBLIC_ERROR_TRACKER_TOKEN`, `ERROR_TRACKER_DSN`, and `ERROR_TRACKER_TOKEN`.

## Task 4: Final Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run focused web test**

Run:

```bash
bun --cwd apps/web test src/components/__tests__/error-tracker-init.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run focused API test**

Run:

```bash
bun test apps/api/src/config/error-tracker.config.test.ts
```

Expected: PASS.

- [ ] **Step 3: Search for hardcoded tracker token**

Run:

```bash
rg -n "token: '" apps packages
```

Expected: no hardcoded tracker token remains in app source.

- [ ] **Step 4: Review git diff**

Run:

```bash
git diff -- apps/web/src/components/error-tracker-init.tsx apps/web/src/components/__tests__/error-tracker-init.test.tsx apps/api/src/main.ts apps/api/src/config/error-tracker.config.ts apps/api/src/config/error-tracker.config.test.ts .env.example PROJECT_SPECS.md CLAUDE.md docs/superpowers/specs/2026-06-18-local-error-tracker-sdk-integration-design.md docs/superpowers/plans/2026-06-18-local-error-tracker-sdk-integration.md
```

Expected: diff only contains local SDK integration, env docs, and the Chinese spec/plan.
