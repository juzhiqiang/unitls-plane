# 本地 API 端口恢复为 3001 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将本地开发 API 从 3003 恢复到项目约定的 3001，并确认 Web 与 API 均可访问。

**Architecture:** 仅修改不受 Git 跟踪的根目录 `.env.local`，让现有 NestJS 启动流程读取 `PORT=3001`。停止旧开发进程并清理冲突监听后重新运行 Turborepo 开发环境，再通过监听进程检查与 HTTP 请求验证结果。

**Tech Stack:** PowerShell、Bun 1.3.13、Turborepo、Next.js 14、NestJS 11

---

### Task 1: 更新本地 API 端口

**Files:**
- Modify (local only, ignored by Git): `.env.local:33`
- Reference: `.env.example:49`

- [ ] **Step 1: 停止当前开发服务**

停止当前后台运行的 `bun run dev` 任务，确保旧 API 进程不再持有 3003。

Expected: 开发任务及其子进程退出。

- [ ] **Step 2: 清理 3000–3100 范围内的旧监听进程**

在 PowerShell 中查询 `Get-NetTCPConnection -State Listen`，筛选 `LocalPort` 为 3000–3100 的记录，并通过对应 `OwningProcess` 结束进程树。

Expected: 启动前该端口范围没有监听进程；若 VS Code Insiders 自动建立端口转发，则结束对应转发进程。

- [ ] **Step 3: 修改本地配置**

将 `.env.local` 中：

```env
PORT=3003
```

改为：

```env
PORT=3001
```

Expected: `.env.local` 仅存在 `PORT=3001`，且该文件保持不受 Git 跟踪。

- [ ] **Step 4: 启动开发环境**

Run:

```powershell
bun run dev
```

Expected: Next.js 日志显示 `http://localhost:3000`，NestJS 日志显示应用成功启动，且无 `EADDRINUSE`。

- [ ] **Step 5: 验证监听进程**

查询 3000 与 3001 的监听进程。

Expected:

```text
3000 -> node.exe (Next.js)
3001 -> bun.exe (NestJS API)
```

- [ ] **Step 6: 执行 HTTP 冒烟验证**

Run:

```powershell
Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing
Invoke-WebRequest -Uri 'http://localhost:3001/health/live' -UseBasicParsing
```

Expected: 两个请求均返回 HTTP 200，健康端点响应包含 `"status":"ok"`。

- [ ] **Step 7: 检查 Git 状态**

Run:

```powershell
git status --short
```

Expected: `.env.local` 不出现在输出中；本任务不产生新的受跟踪文件修改，因此无需创建实现提交。
