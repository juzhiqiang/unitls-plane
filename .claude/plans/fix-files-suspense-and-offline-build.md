# 修复 Next.js 14 静态预渲染失败并完成 utils-plane-offline-all 打包

## 背景

用户指令：**直接打包 utils-plane-offline-all**（即 `bun run docker:package:offline`）。

上一次运行在 Next.js 构建阶段失败（已记录到 `log/docker-package-offline.log`）：

```
@utils-plane/web:build:  ⨯ useSearchParams() should be wrapped in a suspense boundary
at page "/[locale]/files". Read more:
https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
@utils-plane/web:build: Error occurred prerendering page "/en/files".
@utils-plane/web:build: Error occurred prerendering page "/zh/files".
> Export encountered errors on following paths:
    /[locale]/(app)/files/page: /en/files
    /[locale]/(app)/files/page: /zh/files
error: script "build" exited with code 1
ERROR: failed to build: failed to solve: process "/bin/sh -c ..." did not complete
successfully: exit code: 1
```

根因不在 Docker，而在 Next.js 14 的静态预渲染：客户端组件在 App Router 段顶层调用
`useSearchParams()` 时，必须被一个 `<Suspense>` 边界包起来，否则该段会被强制转成动态，但
`/`、`/en`、`/zh` 的 locale 段仍然要静态预渲染 `/files`，于是预渲染阶段直接抛错。

`apps/web/src/app/[locale]/(app)/files/page.tsx` 当前已经是修改过的状态（`git status` 标记为
`M`，未提交）：组件体顶层调用 `useSearchParams()`（第 79 行），但**没有**真正的 `<Suspense>`
边界。文件中还能看到三段误导性的"修复 Next.js 14 App
Router 静态渲染…"注释，看起来像 "已修好"，但其实只是注释，结构性修改从未落地。

`(auth)/login/page.tsx` 和 `(auth)/reset-password/page.tsx` 同样在客户端组件顶层调用
`useSearchParams()`，但它们被 `(auth)/layout.tsx`（一个 `await getTranslations` 的 async server
layout）包住，整个 auth 段因此已经被视为动态，没有参与静态预渲染，所以本次构建不会因它们失败。本计划不为这两个文件加改动；如以后需要静态化它们，再单独修。

## 修复方案（推荐并落地）

采用 Next.js 官方建议：**把使用 `useSearchParams` 的客户端组件包进 `<Suspense>`**。

具体到本文件，**最小侵入**的改法是把它拆成两层：

```tsx
// apps/web/src/app/[locale]/(app)/files/page.tsx
'use client';

import { Suspense, useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
// ... 其余 import 保持不变

function FilesPageContent() {
  // 这里是原 FilesPage 的完整组件体，包括
  //   const searchParams = useSearchParams();
  //   const previewParam = searchParams.get('preview');
  //   const [previewId, setPreviewId] = useState<string | null>(previewParam);
  //   useEffect(() => { ... }, [previewParam]);
  // 以及所有现有逻辑、JSX。
}

export default function FilesPage() {
  return (
    <Suspense fallback={null}>
      <FilesPageContent />
    </Suspense>
  );
}
```

要点：

1. 现有 `FilesPage` 函数体重命名为 `FilesPageContent`，不动任何业务逻辑。
2. 新增的 `FilesPage` 只是 `<Suspense>` 包装层；保留原名（默认导出名）以避免影响调用方。
3. 删除第 66–91 行那三段误导性注释（共 18 行），它们说的修复其实并不存在。
4. `import` 列表里 `Suspense` 新增，`useState, useCallback, useEffect` 保持。
5. `useSearchParams` 仍然在 `FilesPageContent` 顶层调用，但因为它现在被 `<Suspense>`
   边界包住，Next.js 会把这段预渲染推迟/转动态，错误消失。

### 为什么不在 `(app)/layout.tsx` 加 `<Suspense>` 一次性兜底

`(app)/layout.tsx` 当前只包 `SidebarProvider` + `AppSidebar` + `SidebarInset` +
`AppHeader`，是纯客户端结构，没有 `await`。在它外面再加 `<Suspense>` 边界确实能一次解决所有 `(app)`
下的 `useSearchParams` 问题，但：

- 会改变 `SidebarProvider` 等上下文 provider 的渲染时机，可能引起 hydration 警告。
- 与本项目一贯的"工具页各自负责"风格不一致——`/files`
  这条深链是它自己的特性，自己处理 Suspense 更内聚。
- 仓库中其他 `(app)` 子树页面（`/dashboard`、`/image/*`、`/pdf/*`、`/tasks`、`/settings`）都没有用
  `useSearchParams`，目前没必要扩大改动面。

### 为什么不用 `export const dynamic = 'force-dynamic'`

会丢失 `/files` 的静态预渲染优化（Next
14 实际上转成完全 SSR），与本项目其他工具页保持静态导出不一致；同时 `(app)/tasks/page.tsx` 通过
`<Link>` 深链到
`/files?preview=...`，依赖客户端渲染生效，强制动态反而可能让深链首屏闪一下。Suspense 是更轻的修法。

### 为什么不动 `(auth)` 两个文件

本次构建错误只发生在 `/en/files`、`/zh/files`。`(auth)/login`、`(auth)/reset-password` 位于 async
server layout 下，整段已动态化，不参与静态预渲染，所以这次构建不会因为它们失败。它们使用
`useSearchParams` 是为了 `?next=`、`?token=`、`?error=`、`?verified=` 等深链；同样的修法（拆出
`*Content` + `<Suspense>` 包装）以后若要静态化 auth 段再补。

## 测试更新

`apps/web/src/app/[locale]/(app)/files/__tests__/page.test.tsx` 当前直接
`render(<FilesPage />)`，把默认导出当普通组件用。改完之后 `FilesPage` 渲染时会执行
`<Suspense fallback={null}><FilesPageContent /></Suspense>`，没有副作用，但为了让"子组件首次渲染完成后 useSearchParams 才返回真值"的语义更明显，**只需**
把测试里调 `useSearchParams` mock 的入口确认仍然挂在
`FilesPageContent`（同一个文件）上 —— 测试不需要改函数签名。

为安全起见，我把测试里两处 `renderPage()` 调用包一下 `<Suspense>`
让 mock 行为与生产路径一致（避免以后升级 React/Testing Library 时被静默地拿到 null）：

```tsx
import { Suspense } from 'react';

function renderPage() {
  return render(
    <Suspense fallback={null}>
      <NextIntlClientProvider locale="en" messages={en as never}>
        <FilesPage />
      </NextIntlClientProvider>
    </Suspense>
  );
}
```

这样 `FilesPageContent` 在测试里也走 `<Suspense>` 路径，行为与生产一致。

## 验证步骤

1. `bun run format:check:changed` —— 校验改动通过 Prettier（项目规范要求）。
2. `bun --cwd apps/web test --run 'files/__tests__/page.test.tsx'`
   —— 单测覆盖深链预览、关闭时清空 query 等关键路径。
3. `bun run docker:package:offline` —— 重新跑打包，日志重定向到 `log/docker-package-offline.log`。
4. 验证产物 `utils-plane-offline-all.tar`
   出现在仓库根目录，且大小合理（offline 镜像含 postgres:16-alpine + redis:7-alpine + minio/minio +
   minio/mc + utils-plane:all，通常几 GB）。
5. `git status` 确认 `.tar`、`log/`、`artifacts/screenshots/`
   都未进入暂存区（项目规则：Docker 发布包和日志不提交）。

## 提交

按 AGENTS.md 规范，提交信息用中文：

```
fix(web): 为 /files 页面 useSearchParams 添加 Suspense 边界

Next.js 14 在静态预渲染 /en/files 与 /zh/files 时会因为 useSearchParams 顶层调用而
抛错，阻断 docker:package:offline 打包。把 FilesPage 拆为 FilesPageContent + 默认导出
包一层 Suspense，让预渲染可正常退出；同步把误导性的"修复"注释清掉，并补 tests/__tests__/page.test.tsx 的 Suspense 包装，保持 mock 行为与生产一致。
```

## 影响范围

- `apps/web/src/app/[locale]/(app)/files/page.tsx` —— 改：拆出 `FilesPageContent` + `<Suspense>`
  包装；删除 18 行误导注释。
- `apps/web/src/app/[locale]/(app)/files/__tests__/page.test.tsx` —— 改：`renderPage()` 外层包
  `<Suspense fallback={null}>`。
- 其它文件不动。

预计：单测 5 个用例全部通过；offline docker build 走完到 `docker save` 成功输出
`utils-plane-offline-all.tar`。
