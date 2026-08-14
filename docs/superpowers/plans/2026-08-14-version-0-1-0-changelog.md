# v0.1.0 版本统一与更新日志实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将全部 workspace 版本统一为 `0.1.0`，并上线可持续维护的双语用户精选更新日志页。

**Architecture:** 使用 `@utils-plane/utils` 导出的版本常量作为界面展示来源，package
manifest 保留标准版本字段并由测试校验一致性。更新日志内容位于 Next Intl 消息文件，页面通过无状态
`Changelog` 组件渲染版本时间线，公开路由沿用营销页布局和 SEO 模式。

**Tech Stack:** Bun workspace、TypeScript、Next.js 14 App Router、React 18、Next
Intl、Vitest、Testing Library、Tailwind CSS。

---

### Task 1: 统一 workspace 与界面版本来源

**Files:**

- Create: `packages/utils/src/release.ts`
- Create: `packages/utils/src/release.test.ts`
- Modify: `packages/utils/src/index.ts`
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/api/package.json`
- Modify: `packages/auth/package.json`
- Modify: `packages/db/package.json`
- Modify: `packages/utils/package.json`
- Modify: `packages/validators/package.json`
- Modify: `packages/api-client/package.json`
- Modify: `bun.lock`

- [ ] **Step 1: 写版本一致性失败测试**

在 `packages/utils/src/release.test.ts` 中断言共享常量、根包、两个应用和五个共享包均为 `0.1.0`：

```ts
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION, APP_VERSION_LABEL } from './release';

const manifests = [
  'package.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'packages/auth/package.json',
  'packages/db/package.json',
  'packages/utils/package.json',
  'packages/validators/package.json',
  'packages/api-client/package.json',
];

describe('release version', () => {
  it('uses v0.1.0 in shared release metadata', () => {
    expect(APP_VERSION).toBe('0.1.0');
    expect(APP_VERSION_LABEL).toBe('v0.1.0');
  });

  it.each(manifests)('keeps %s on the shared version', path => {
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, '../../..', path), 'utf8'));
    expect(manifest.version).toBe(APP_VERSION);
  });
});
```

- [ ] **Step 2: 运行 RED 测试**

Run: `bun test packages/utils/src/release.test.ts`

Expected: FAIL，因为 `release.ts` 尚不存在且 manifest 版本不一致。

- [ ] **Step 3: 添加共享版本常量并统一 manifest**

`packages/utils/src/release.ts`：

```ts
export const APP_VERSION = '0.1.0';
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
```

从 `packages/utils/src/index.ts` 导出该模块，并将所有列出的 manifest 设为 `"version": "0.1.0"`。运行
`bun install --lockfile-only` 同步 `bun.lock`。

- [ ] **Step 4: 运行 GREEN 测试**

Run: `bun test packages/utils/src/release.test.ts`

Expected: PASS。

### Task 2: 新增可复用更新日志时间线组件

**Files:**

- Create: `apps/web/src/components/layout/Changelog.tsx`
- Create: `apps/web/src/components/layout/__tests__/Changelog.test.tsx`

- [ ] **Step 1: 写组件失败测试**

使用 Testing Library 传入一个 `v0.1.0`
条目，断言版本、日期、标题、摘要、分组和列表项均可见，并断言每个版本使用 `article` 语义结构。

- [ ] **Step 2: 运行 RED 测试**

Run: `bun --cwd apps/web run test -- "src/components/layout/__tests__/Changelog.test.tsx"`

Expected: FAIL，因为组件尚不存在。

- [ ] **Step 3: 实现时间线组件**

导出 `ChangelogEntry` 类型及 `Changelog` 组件。组件接收 `title`、`intro`、`entries`，使用响应式
`grid`：桌面端版本元信息为窄列、内容为主列，移动端自动单列。每个分组使用标题和带可见圆点的列表，不增加嵌套卡片。

- [ ] **Step 4: 运行 GREEN 测试**

Run: `bun --cwd apps/web run test -- "src/components/layout/__tests__/Changelog.test.tsx"`

Expected: PASS。

### Task 3: 添加双语更新日志公开页

**Files:**

- Create: `apps/web/src/app/[locale]/(marketing)/changelog/page.tsx`
- Create: `apps/web/src/app/[locale]/(marketing)/changelog/__tests__/page.test.ts`
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: 写路由与内容失败测试**

测试读取页面源码，断言存在
`PublicSite.changelog.metadata`、`getTranslations('PublicSite.changelog')`、`setRequestLocale`、canonical 和语言 alternates；同时断言中英文
`entries[0].version` 为 `v0.1.0`，包含三个分组且每组至少一个用户可感知条目。

- [ ] **Step 2: 运行 RED 测试**

Run:
`bun --cwd apps/web run test -- "src/app/[locale]/(marketing)/changelog/__tests__/page.test.ts"`

Expected: FAIL，因为路由与消息命名空间尚不存在。

- [ ] **Step 3: 实现页面与精选内容**

页面沿用隐私/条款页的 metadata 模式，但主体调用：

```tsx
<Changelog title={t('title')} intro={t('intro')} entries={t.raw('entries') as ChangelogEntry[]} />
```

中英文首条日志日期使用 `2026-08-14`，分组为新功能、改进、修复，内容仅描述用户可感知变化。

- [ ] **Step 4: 运行 GREEN 测试**

Run:
`bun --cwd apps/web run test -- "src/app/[locale]/(marketing)/changelog/__tests__/page.test.ts"`

Expected: PASS。

### Task 4: 接入页脚、认证页和公开路由发现

**Files:**

- Modify: `apps/web/src/app/[locale]/(marketing)/layout.tsx`
- Modify: `apps/web/src/app/[locale]/(auth)/layout.tsx`
- Modify: `apps/web/src/app/[locale]/(marketing)/__tests__/public-trust-pages.test.ts`
- Modify: `apps/web/src/app/[locale]/(auth)/auth-layout-metadata.test.ts`
- Modify: `apps/web/src/app/sitemap.ts`
- Modify: `apps/web/src/app/robots.ts`
- Modify: `apps/web/src/app/sitemap.test.ts`
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: 扩展入口与路由失败测试**

断言营销页脚包含 `href="/changelog"`，认证布局从 `@utils-plane/utils` 读取 `APP_VERSION_LABEL`
并链接 `/changelog`，sitemap 包含本地化 changelog URL，robots 不把 changelog 视为私有路径。

- [ ] **Step 2: 运行 RED 测试**

Run:
`bun --cwd apps/web run test -- "src/app/[locale]/(marketing)/__tests__/public-trust-pages.test.ts" "src/app/[locale]/(auth)/auth-layout-metadata.test.ts" "src/app/sitemap.test.ts"`

Expected: FAIL，因为入口和路由列表尚未更新。

- [ ] **Step 3: 接入所有入口**

页脚增加本地化更新日志链接；认证页将硬编码 `v1.0.0` 替换为包裹 `APP_VERSION_LABEL` 的
`Link`；在公开路由、sitemap 和测试常量中加入 `changelog`。

- [ ] **Step 4: 运行 GREEN 测试**

Run:
`bun --cwd apps/web run test -- "src/app/[locale]/(marketing)/__tests__/public-trust-pages.test.ts" "src/app/[locale]/(auth)/auth-layout-metadata.test.ts" "src/app/sitemap.test.ts"`

Expected: PASS。

### Task 5: 更新文档并完成验证

**Files:**

- Modify: `README.md`
- Modify: `PROJECT_SPECS.md`

- [ ] **Step 1: 更新项目事实**

在当前能力说明中记录统一版本 `v0.1.0`、公开更新日志路由
`/{locale}/changelog`、精选日志维护规则和两个页面入口。

- [ ] **Step 2: 格式与差异检查**

Run: `bun run format:check:changed`

Expected: PASS。

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 3: 运行完整自动化验证**

Run: `bun run test:packages`

Expected: PASS。

Run: `bun run test:web`

Expected: PASS。

Run: `bun --cwd apps/web run build`

Expected: 编译、类型检查和静态页面生成成功；Windows standalone symlink 可能继续出现已知 `EPERM`
警告，但命令退出码必须为 0。

- [ ] **Step 4: 浏览器响应式核对**

在开发服务中访问 `/zh/changelog` 和
`/en/changelog`，核对桌面和移动视口无溢出、内容顺序正确、页脚与认证页入口可用，并确认浏览器控制台无新增错误。

- [ ] **Step 5: 提交实现**

```bash
git add package.json bun.lock apps packages README.md PROJECT_SPECS.md
git commit -m "feat(web): 添加 v0.1.0 更新日志"
```
