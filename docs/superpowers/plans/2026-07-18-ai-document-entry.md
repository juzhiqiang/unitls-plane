# AI 协作文档入口整理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `AGENTS.md` 建立为 Codex 与 Claude 共用的公共规则入口，并在 `README.md` 中清楚说明
`AGENTS.md`、`CLAUDE.md`、`PROJECT_SPECS.md` 的职责和关系。

**Architecture:** `AGENTS.md` 保存 AI 协作规则，Codex 直接读取，Claude Code 由 `CLAUDE.md` 的
`@AGENTS.md` 导入。`PROJECT_SPECS.md` 只保存项目事实，`README.md`
只提供人类可读的导航和入口说明；公共规则和项目事实都不在入口文档中重复复制。

**Tech Stack:** Markdown、Git、Prettier、PowerShell、ripgrep

---

### Task 1: 明确 AGENTS.md 的公共规则入口身份

**Files:**

- Modify: `AGENTS.md:1-11`

- [ ] **Step 1: 更新文档定位和文档结构列表**

将文件开头的说明和“文档结构”调整为以下内容，保留后续项目概述和全部现有规则：

```markdown
# Utils-Plane 项目规范

> 本文档是 Codex 与 Claude 共用的公共协作规则入口，定义团队编码规范和开发约定。项目事实以
> [PROJECT_SPECS.md](./PROJECT_SPECS.md) 为准。

## 文档结构

- [README.md](./README.md) - 项目介绍、启动方式和文档导航
- [AGENTS.md](./AGENTS.md) - Codex 与 Claude 共用的 AI 协作规则入口
- [CLAUDE.md](./CLAUDE.md) - Claude Code 专属入口，通过 `@AGENTS.md` 导入本文件
- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 项目技术规范和当前架构事实
- [task/](./task/) - phase1-phase8 任务文档
```

- [ ] **Step 2: 检查规则没有被误删**

运行：

```powershell
rg -n "中文|必须创建 Git 提交|不要提交 `.env.local`|日志|截图" AGENTS.md
```

预期：仍能找到中文文档/Git 提交、环境文件、日志和截图规则。

### Task 2: 让 CLAUDE.md 导入公共规则并移除重复规则

**Files:**

- Modify: `CLAUDE.md:1-5`
- Modify: `CLAUDE.md:190-227`

- [ ] **Step 1: 添加 Claude Code 的公共规则导入**

将文件顶部替换为以下入口说明，保留后面的项目快速开始和项目导航内容：

```markdown
# Utils-Plane 项目 AI 开发指南

@AGENTS.md

> 本文件是 Claude Code 的项目入口。公共协作规则以 `AGENTS.md` 为准，项目事实以
> [PROJECT_SPECS.md](./PROJECT_SPECS.md) 为准；本文件只补充 Claude 使用时的快速开始和代码导航。
```

- [ ] **Step 2: 删除 CLAUDE.md 中重复的公共规则段落**

删除从 `## 开发约定` 到 `## 参考文档`
之前的“开发约定”、以及其后的“日志文件规范”和“核对截图规范”段落。保留 `## 参考文档`，并将其调整为：

```markdown
## 参考文档

- [AGENTS.md](./AGENTS.md) - Codex 与 Claude 共用的公共协作规则
- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 项目技术规范和当前架构事实
- [README.md](./README.md) - 项目介绍、启动方式和完整文档导航
- [task/](./task/) - phase1-phase8 任务文档
```

- [ ] **Step 3: 确认 Claude 入口只保留一处公共导入**

运行：

```powershell
rg -n "^@AGENTS\.md$|AGENTS\.md|## 开发约定|日志文件规范|核对截图规范" CLAUDE.md
```

预期：`@AGENTS.md` 恰好出现一处；保留导航链接中的
`AGENTS.md`，不再出现“开发约定”“日志文件规范”或“核对截图规范”标题。

### Task 3: 在 README.md 公开文档关系和维护入口

**Files:**

- Modify: `README.md:4-6`
- Modify: `README.md:500-508`

- [ ] **Step 1: 在产品简介后增加文档关系说明**

在 `## 公开公测边界` 之前增加以下章节：

```markdown
## 文档关系与维护入口

| 文档               | 负责内容                                             | 何时修改                               |
| ------------------ | ---------------------------------------------------- | -------------------------------------- |
| `AGENTS.md`        | Codex 与 Claude 共用的编码、验证、提交和产物管理规则 | 修改公共 AI 协作规则时只改这里         |
| `CLAUDE.md`        | Claude Code 入口、快速开始和代码导航                 | 只补充 Claude 专属导航，不复制公共规则 |
| `PROJECT_SPECS.md` | 当前架构、技术栈、产品边界和部署事实                 | 项目事实发生变化时修改这里             |
| `README.md`        | 面向开发者和部署人员的项目介绍、启动方式和文档导航   | 项目入口或使用流程发生变化时修改       |

Codex 会直接读取 `AGENTS.md`；Claude Code 通过 `CLAUDE.md` 中的 `@AGENTS.md`
导入同一份公共规则。普通 Markdown 链接只用于导航，不会替代规则导入。公共规则与项目事实发生冲突时，以
`AGENTS.md` 的协作规则和 `PROJECT_SPECS.md` 的事实内容为准。
```

- [ ] **Step 2: 更新 README 文档列表的职责描述**

将现有“文档”列表替换为：

```markdown
## 文档

- [AGENTS.md](./AGENTS.md) - Codex 与 Claude 共用的公共协作规则入口
- [CLAUDE.md](./CLAUDE.md) - Claude Code 专属入口和快速开发导航
- [PROJECT_SPECS.md](./PROJECT_SPECS.md) - 项目技术规范和当前架构事实
- [task/](./task/) - phase1-phase8 任务文档
```

- [ ] **Step 3: 检查 README 没有复制公共规则**

运行：

```powershell
rg -n "文档关系与维护入口|AGENTS\.md|CLAUDE\.md|PROJECT_SPECS\.md|中文提交|必须创建 Git 提交" README.md
```

预期：能找到文档关系和入口说明；README 不新增具体公共规则，只说明规则应维护在 `AGENTS.md`。

### Task 4: 文档一致性验证与提交

**Files:**

- Test: `AGENTS.md`
- Test: `CLAUDE.md`
- Test: `README.md`

- [ ] **Step 1: 检查 Markdown 格式和空白**

运行：

```powershell
bunx prettier --check AGENTS.md CLAUDE.md README.md
git diff --check
```

预期：Prettier 输出 `All matched files use Prettier code style!`，`git diff --check`
无输出且返回 0。

- [ ] **Step 2: 验证入口和重复内容**

运行：

```powershell
$claudeImportCount = (Select-String -Path 'CLAUDE.md' -Pattern '^@AGENTS\.md$').Count
if ($claudeImportCount -ne 1) { throw "CLAUDE.md 的 @AGENTS.md 导入次数为 $claudeImportCount，不是 1" }
if (Select-String -Path 'CLAUDE.md' -Pattern '^## 开发约定$|^### 日志文件规范$|^### 核对截图规范$') { throw 'CLAUDE.md 仍含有已抽离的公共规则章节' }
if (-not (Select-String -Path 'README.md' -Pattern '^## 文档关系与维护入口$')) { throw 'README.md 缺少文档关系说明' }
```

预期：命令无异常退出。

- [ ] **Step 3: 检查提交范围并创建中文提交**

依次运行：

```powershell
git status --short
git diff --check
git add -- AGENTS.md CLAUDE.md README.md
git diff --cached --name-only
git commit -m "docs: 统一 AI 协作文档入口"
```

预期：暂存区只包含 `AGENTS.md`、`CLAUDE.md` 和 `README.md`，提交成功，提交标题使用中文。

- [ ] **Step 4: 提交后确认工作区状态**

运行：

```powershell
git status --short
git log -1 --oneline
```

预期：除用户原有且未纳入本次范围的改动外没有新增未提交文件，最新提交为
`docs: 统一 AI 协作文档入口`。
