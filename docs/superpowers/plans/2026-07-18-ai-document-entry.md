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

---

# Markdown / Word 转 PDF 稳定性与多页预览实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:**
修复生产环境 Markdown 服务端 PDF 的空白首页/内容缺失问题，并为 PDF 结果预览增加多页翻页和完整缩略图。

**Architecture:** 保留 LibreOffice 作为 Markdown 高保真转换首选，为每次转换隔离 user
profile，并按页校验和清理输出；校验失败时尝试第二种 LibreOffice
filter，最后使用现有 fallback。前端在 `PdfResultPreview`
内管理当前页、主 canvas 和全部缩略图，使用现有 `pdf-client` 渲染 API，不改变任务或文件接口。

**Tech Stack:** NestJS、Bun test、pdf-lib、MuPDF、LibreOffice、Next.js 14、React
18、pdfjs-dist、Vitest、Testing Library、Prettier。

**范围约束:** 保留用户现有 `apps/web/package.json` 端口修改，不暂存 `.env*`、Docker
tar 包或其他无关文件。每个任务完成并通过对应验证后创建中文 Git 提交。

### Task 1: 为服务端输出校验建立失败测试

**Files:**

- Modify: `apps/api/src/modules/tasks/services/pdf.service.test.ts`
- Test target: `apps/api/src/modules/tasks/services/pdf.service.ts`

- [ ] **Step 1: 添加可生成指定页面文本的测试辅助函数**

在现有 `createMinimalDocx` 辅助函数之后添加：

```typescript
async function createTextPdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const text of pages) {
    const page = doc.addPage([595.28, 841.89]);
    if (text) {
      page.drawText(text, { x: 56, y: 780, size: 12, font });
    }
  }

  return Buffer.from(await doc.save());
}
```

同时把导入改为 `import { PDFDocument, StandardFonts } from 'pdf-lib';`。

- [ ] **Step 2: 写首页空白和正文缺失的回归测试**

在 `describe('PdfService.documentToPdf', ...)` 中添加以下两个测试。测试通过 monkey
patch 控制 LibreOffice 输出，模拟线上坏结果：

```typescript
it('removes leading blank pages from an otherwise valid Markdown PDF', async () => {
  const service = new PdfService();
  const originalConverter = (service as any).convertWithLibreOffice;
  (service as any).convertWithLibreOffice = async (sourcePath: string, outputDir: string) => {
    const outputPath = join(
      outputDir,
      sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
    );
    await writeFile(outputPath, await createTextPdf(['', 'Expected title and body']));
    return outputPath;
  };

  try {
    const pdf = await service.documentToPdf(
      {
        buffer: Buffer.from('# Expected title\n\nExpected title and body'),
        filename: 'source.md',
      },
      { sourceFormat: 'markdown' }
    );

    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    await expect(service.toText(pdf, { format: 'text' })).resolves.toContain(
      'Expected title and body'
    );
  } finally {
    (service as any).convertWithLibreOffice = originalConverter;
  }
});

it('falls back when a LibreOffice PDF is missing Markdown content', async () => {
  const service = new PdfService();
  const originalConverter = (service as any).convertWithLibreOffice;
  (service as any).convertWithLibreOffice = async (sourcePath: string, outputDir: string) => {
    const outputPath = join(
      outputDir,
      sourcePath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '.pdf')
    );
    await writeFile(outputPath, await createTextPdf(['Only one fragment']));
    return outputPath;
  };

  try {
    const pdf = await service.documentToPdf(
      {
        buffer: Buffer.from('# Required heading\n\nContent that must survive'),
        filename: 'source.md',
      },
      { sourceFormat: 'markdown' }
    );
    const text = await service.toText(pdf, { format: 'text' });

    expect(text).toContain('Required heading');
    expect(text).toContain('Content that must survive');
  } finally {
    (service as any).convertWithLibreOffice = originalConverter;
  }
});
```

- [ ] **Step 3: 运行服务端测试确认新测试先失败**

运行：

```powershell
bun --cwd apps/api test src/modules/tasks/services/pdf.service.test.ts
```

预期：现有测试通过，但新增测试失败；首页空白测试仍得到 2 页，正文缺失测试仍得到
`Only one fragment`。这证明测试捕获的是当前缺陷而不是拼写错误。

- [ ] **Step 4: 提交失败测试**

确认 `git diff --name-only` 只有 `apps/api/src/modules/tasks/services/pdf.service.test.ts` 后运行：

```powershell
git commit --only -m "test: 覆盖文档 PDF 空白页和内容缺失" -- apps/api/src/modules/tasks/services/pdf.service.test.ts
```

### Task 2: 实现隔离的 LibreOffice 转换和严格 Markdown 校验

**Files:**

- Modify: `apps/api/src/modules/tasks/services/pdf.service.ts:90-170,386-455,869-910`
- Test: `apps/api/src/modules/tasks/services/pdf.service.test.ts`

- [ ] **Step 1: 扩展 HTML 文档结构测试**

在 `buildMarkdownDocumentHtml` 的测试中增加：

```typescript
expect(html).toContain('<html lang="zh-CN">');
expect(html).toContain('<main class="markdown-document">');
```

- [ ] **Step 2: 添加可测试的 LibreOffice 参数构造函数**

在服务文件中从 `node:url` 导入 `pathToFileURL`，并添加导出函数：

```typescript
export function buildLibreOfficeArgs(
  sourcePath: string,
  outputDir: string,
  profileDir: string,
  filter: 'pdf:writer_pdf_Export' | 'pdf'
): string[] {
  return [
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--headless',
    '--invisible',
    '--nodefault',
    '--nolockcheck',
    '--nologo',
    '--nofirststartwizard',
    '--convert-to',
    filter,
    '--outdir',
    outputDir,
    sourcePath,
  ];
}
```

在服务端测试中断言参数包含 `-env:UserInstallation=file:///`、`--nodefault`
和传入的 filter。该纯函数不启动 LibreOffice，测试在 Windows 和 Linux 路径下都可运行。

- [ ] **Step 3: 实现 Markdown 文本片段提取和 PDF 页面文本读取**

新增内部辅助函数，规则固定如下：先把 Markdown 转成已安全清理的 HTML，在块级结束标签前插入换行，移除其余标签并解码常见 HTML 实体；再把连续空白归一化，每个长度至少为 2 的非空块作为待校验片段。PDF 页面文本使用现有
`getMupdf()`，按 `doc.countPages()` 顺序读取 `page.toStructuredText().asText()`。

```typescript
function normalizeDocumentText(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
```

片段提取必须使用和 HTML 生成相同的 `marked` 配置，避免校验文本与实际导出内容不一致。

- [ ] **Step 4: 实现前置空白页清理和严格校验**

增加 `normalizeMarkdownPdfOutput(pdf, markdown)`：

1. 读取每页文本，找到第一张非空页；全部为空则抛出
   `Error('LibreOffice produced a blank Markdown PDF')`。
2. 将所有 Markdown 片段归一化后逐一检查是否出现在从第一张非空页开始的 PDF 文本中；缺少任何片段就抛出带缺失片段数量的错误。
3. 如果第一张非空页不是第 1 页，使用 `PDFDocument.load`、`copyPages`
   复制剩余页面生成新 PDF，只删除前置空白页。
4. 返回校验后的 PDF buffer。

将 `ensureMarkdownPdfHasContent` 替换为该函数，保留 DOCX fallback 不变。

- [ ] **Step 5: 实现隔离 profile 和双 filter 转换**

将 `convertWithLibreOffice` 改为接收 `filter`
参数。每次调用在任务临时目录下创建独立的输出目录和 profile 目录，把 `buildLibreOfficeArgs(...)` 传给
`execFileAsync`，成功后只返回本次输出路径。`documentToPdf` 的 Markdown 分支按
`['pdf:writer_pdf_Export', 'pdf']` 顺序尝试：读取输出、调用
`normalizeMarkdownPdfOutput`，成功立即返回；任一命令异常或校验异常则进入下一 filter。两次都失败才调用现有
`renderMarkdownFallbackPdf`。DOCX 只调用一次显式 Writer filter。

- [ ] **Step 6: 运行服务端测试确认变绿**

运行：

```powershell
bun --cwd apps/api test src/modules/tasks/services/pdf.service.test.ts
```

预期：该文件所有测试通过，新增首页空白、正文缺失和命令参数测试均为 PASS。

- [ ] **Step 7: 提交服务端修复**

```powershell
git commit --only -m "fix: 修复 Markdown 服务端 PDF 输出" -- apps/api/src/modules/tasks/services/pdf.service.ts apps/api/src/modules/tasks/services/pdf.service.test.ts
```

### Task 3: 为多页结果预览建立失败测试

**Files:**

- Modify: `apps/web/src/components/tools/__tests__/markdown-preview.test.tsx`
- Test target: `apps/web/src/components/tools/pdf-result-preview.tsx`

- [ ] **Step 1: 添加 pdf-client mock 和 canvas 数据 URL mock**

在现有测试文件中导入 `fireEvent`、`waitFor`、`vi` 和 `PdfResultPreview`，并添加：

```typescript
vi.mock('@/lib/processing/pdf-client', () => ({
  loadPdf: vi.fn(async () => ({ numPages: 3 })),
  renderPdfPage: vi.fn(async (_pdf, pageNumber, _scale, targetCanvas) => {
    const canvas = targetCanvas ?? document.createElement('canvas');
    Object.defineProperty(canvas, 'width', { configurable: true, value: 600 });
    Object.defineProperty(canvas, 'height', { configurable: true, value: 840 });
    canvas.toDataURL = () => `data:image/png;base64,page-${pageNumber}`;
    return canvas;
  }),
}));
```

- [ ] **Step 2: 写三页翻页、缩略图和边界测试**

渲染 `PdfResultPreview` 时传入
`previousLabel="上一页"`、`nextLabel="下一页"`、`pageIndicator={(page,total) => `第
${page} /
${total} 页`}`、`thumbnailLabel={page => `第 ${page} 页缩略图`}` 和
`loadingLabel="加载中"`。断言：等待后有 3 个缩略图按钮；初始页码为第 1/3 页且上一页禁用；点击下一页后为第 2/3 页；点击第 3 页缩略图后为第 3/3 页且下一页禁用；主图
`src` 使用 page-3 data URL。

- [ ] **Step 3: 运行 Web 定向测试确认先失败**

```powershell
bun --cwd apps/web test src/components/tools/__tests__/markdown-preview.test.tsx
```

预期：原有 Markdown 测试通过，新增 PDF 预览测试失败，因为当前组件没有分页按钮、缩略图或对应 props。

- [ ] **Step 4: 提交前端失败测试**

```powershell
git commit --only -m "test: 覆盖 PDF 多页预览交互" -- apps/web/src/components/tools/__tests__/markdown-preview.test.tsx
```

### Task 4: 实现多页翻页和完整缩略图

**Files:**

- Modify: `apps/web/src/components/tools/pdf-result-preview.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/pdf/from-document/page.tsx`
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`
- Test: `apps/web/src/components/tools/__tests__/markdown-preview.test.tsx`

- [ ] **Step 1: 扩展 `PdfResultPreviewProps` 和状态**

新增 `previousLabel`、`nextLabel`、`pageIndicator`、`thumbnailLabel`、`loadingLabel` props；状态包含
`currentPage`、`mainCanvas`、`thumbnails: Record<number, HTMLCanvasElement>`、`thumbnailErrors` 和
`error`。文件变化时清空旧状态并把当前页重置为 1。

- [ ] **Step 2: 实现 PDF 加载、主页面渲染和有限并发缩略图队列**

加载后设置 `pdf.numPages`，主页面用 `renderPdfPage(pdf, currentPage, 0.7)`；缩略图用
`renderPdfPage(pdf, page, 0.2)`，最多同时运行 3 个 worker。每个异步回调先检查
`cancelled`，组件卸载时只设置取消标记，不再写入状态。加载新文件时若旧文档提供
`destroy()`，调用并忽略其清理异常。

- [ ] **Step 3: 添加导航和完整页面布局**

主预览使用：

```tsx
<div className="max-h-[560px] overflow-auto rounded border border-border bg-background p-2">
  {mainCanvas && (
    <PdfPagePreviewImage
      canvas={mainCanvas}
      alt={pageIndicator(currentPage, pdf.numPages)}
      className="mx-auto h-auto max-h-[520px] max-w-full w-auto object-contain"
    />
  )}
</div>
```

页面下方放上一页/下一页按钮和页码；缩略图使用 `button` 网格，图片只设置
`h-auto max-w-full w-auto object-contain`，容器
`max-h-[360px] overflow-y-auto`，不设置会裁切页面的固定 aspect ratio。当前页按钮添加
`aria-current="page"` 和边框高亮。

- [ ] **Step 4: 接入中英文文案**

在两个 message 文件 `PdfTool.fromDocument` 下增加同名键。中文值为
`上一页`、`下一页`、`第 {page} / {total} 页`、`第 {page} 页缩略图`、`正在加载 PDF...`；英文值为
`Previous page`、`Next page`、`Page {page} of {total}`、`Thumbnail for page {page}`、`Loading PDF...`。页面通过
`t(...)` 生成函数并传给组件，不能在组件内硬编码文案。

- [ ] **Step 5: 运行 Web 定向测试确认变绿**

```powershell
bun --cwd apps/web test src/components/tools/__tests__/markdown-preview.test.tsx
```

预期：Markdown 与 PDF 预览测试全部 PASS，且无 React act 警告。

- [ ] **Step 6: 提交前端修复**

```powershell
git commit --only -m "fix: 支持 PDF 多页翻页和完整缩略图" -- apps/web/src/components/tools/pdf-result-preview.tsx "apps/web/src/app/[locale]/(app)/pdf/from-document/page.tsx" apps/web/messages/zh.json apps/web/messages/en.json apps/web/src/components/tools/__tests__/markdown-preview.test.tsx
```

### Task 5: 全量验证与收尾

**Files:**

- Test: `apps/api/src/modules/tasks/services/pdf.service.test.ts`
- Test: `apps/web/src/components/tools/__tests__/markdown-preview.test.tsx`
- Verify: `apps/api/src/modules/tasks/services/pdf.service.ts`
- Verify: `apps/web/src/components/tools/pdf-result-preview.tsx`

- [ ] **Step 1: 运行 API 与 Web 全量测试**

```powershell
bun run test:api
bun run test:web
```

预期：两个命令均以退出码 0 完成，失败数为 0。

- [ ] **Step 2: 运行格式和差异门禁**

```powershell
bunx prettier --check apps/api/src/modules/tasks/services/pdf.service.ts apps/api/src/modules/tasks/services/pdf.service.test.ts apps/web/src/components/tools/pdf-result-preview.tsx apps/web/src/components/tools/__tests__/markdown-preview.test.tsx "apps/web/src/app/[locale]/(app)/pdf/from-document/page.tsx" apps/web/messages/zh.json apps/web/messages/en.json
git diff --check
```

预期：Prettier 输出 `All matched files use Prettier code style!`，`git diff --check` 无输出。

- [ ] **Step 3: 检查提交范围和工作区**

```powershell
git status --short
git log -5 --oneline
```

预期：只剩用户原有的 `apps/web/package.json` 修改；本次提交不包含 `.env*`、Docker
tar 包或规格之外的文件。若验证发现代码仍有未提交修改，先按文件范围创建中文修复提交再结束。

## 附录：Markdown 编辑器固定高度与源码高亮实施计划（2026-07-19）

> For agentic
> workers: 本附录沿用本计划的 subagent-driven-development 要求；每个任务先写失败测试，再实现并在独立复审后提交。

Goal：让 Markdown 编辑器固定为 520px 高度，并在保留原生输入行为的前提下按 Markdown token 高亮源码。

Architecture：MarkdownEditor 继续以受控 textarea 作为唯一输入源，在其下方叠加只读高亮层。高亮层由项目已有的 highlight.js
Markdown
grammar 生成 HTML；textarea、行号和高亮层共享字体、行高、内边距，并由 textarea 的滚动事件同步纵向和横向位置。

Tech Stack：Next.js 14、React 18、TypeScript、highlight.js 11、Vitest、Testing Library、Tailwind
CSS。

### 任务 1：为固定视口和源码高亮建立失败测试

Files：

- Modify：`apps/web/src/components/tools/__tests__/markdown-editor.test.tsx`
- Test target：apps/web/src/components/tools/markdown-editor.tsx

- [ ] Step 1：写固定高度和滚动契约测试

在现有 MarkdownEditor 测试中渲染长 Markdown，断言 textarea 具有 wrap=off、h-full、resize-none、overflow-auto，且容器包含 h-[520px]。测试必须证明编辑器外层是固定高度，而不是当前的 min-h-[520px]
加 resize-y。

- [ ] Step 2：写 Markdown token 高亮测试

使用包含标题、列表、链接、强调和代码围栏的源码，断言存在 pre[aria-hidden=true]
高亮层、code.hljs 节点和至少两个 span[class*=hljs-]
token，同时确认标题和链接文本仍可见。高亮层必须是只读展示，不应替代 textarea。

- [ ] Step 3：写滚动同步测试并保留原始输入测试

设置 textarea 的 scrollTop=144 和 scrollLeft=32 后触发 scroll 事件，断言行号容器与高亮层收到相同 scrollTop，高亮层收到相同 scrollLeft。保留现有 onChange 用例，确保高亮只改变显示层，不转换 Markdown 字符串。

- [ ] Step 4：运行测试确认 RED

运行：

    bun run --cwd apps/web test src/components/tools/__tests__/markdown-editor.test.tsx

预期：现有基础编辑器用例通过，新增固定视口、高亮层和滚动同步用例因当前组件没有对应结构而失败；失败原因不能是测试导入或语法错误。

- [ ] Step 5：格式检查并提交失败测试

运行：

    bunx prettier --check apps/web/src/components/tools/__tests__/markdown-editor.test.tsx
    git diff --check
    git commit --only -m "test: 覆盖 Markdown 编辑器固定高度和源码高亮" -- apps/web/src/components/tools/__tests__/markdown-editor.test.tsx

提交范围只能包含现有测试文件，保留用户已有的 apps/web/package.json 修改。

### 任务 2：实现固定高度、同步滚动和 Markdown 源码高亮

Files：

- Modify：apps/web/src/components/tools/markdown-editor.tsx

- [ ] Step 1：注册 Markdown 高亮语言并提供安全回退

在 markdown-editor.tsx 中从 highlight.js/lib/core 导入 hljs，从 highlight.js/lib/languages/markdown 导入 Markdown
grammar，并在模块级注册 markdown。实现 highlightMarkdownSource(value)：正常路径调用 hljs.highlight(value,
{ language: 'markdown', ignoreIllegals: true
}).value；异常路径返回转义了 ampersand、尖括号、双引号和单引号的纯文本 HTML。用 useMemo 只在源码变化时重新计算。

- [ ] Step 2：将编辑视口改为固定高度

把当前 min-h-[520px]
和 resize-y 改为 h-[520px]、min-h-0、resize-none。textarea 使用 h-full、w-full、overflow-auto、whitespace-pre 和 wrap=off；保留现有字号、行高、行号、disabled、value、onChange 和统计逻辑。

- [ ] Step 3：叠加高亮层并同步两轴滚动

在 textarea 所在区域加入绝对定位的 pre 和 code.hljs。pre 设置 aria-hidden=true、pointer-events-none、与 textarea 相同的 px/py、字体和 leading；code 使用 dangerouslySetInnerHTML 展示高亮结果。textarea 放在高亮层上方，文字透明但保留 foreground
caret 与选区。滚动处理器同时更新 gutter 的 scrollTop、高亮层的 scrollTop 和 scrollLeft，不能让高亮层抢占焦点。

- [ ] Step 4：运行目标测试确认 GREEN

运行：

    bun run --cwd apps/web test src/components/tools/__tests__/markdown-editor.test.tsx

预期：所有 MarkdownEditor 测试通过，没有 React act 警告、未处理 Promise 或高亮 HTML 解析错误。

- [ ] Step 5：提交编辑器实现

运行：

    bunx prettier --check apps/web/src/components/tools/markdown-editor.tsx apps/web/src/components/tools/__tests__/markdown-editor.test.tsx
    git diff --check
    git commit --only -m "feat: 增加 Markdown 编辑器源码高亮" -- apps/web/src/components/tools/markdown-editor.tsx apps/web/src/components/tools/__tests__/markdown-editor.test.tsx

提交不得包含消息文件、全局配色变量、任务接口或 apps/web/package.json。

### 任务 3：全量验证与视觉核对

Files：

- Verify：apps/web/src/components/tools/markdown-editor.tsx
- Verify：`apps/web/src/components/tools/__tests__/markdown-editor.test.tsx`
- Verify：apps/web/src/app/globals.css

- [ ] Step 1：运行 Web 全量测试、lint 和 build

运行：

    bun run test:web
    bun run --cwd apps/web lint
    bun run --cwd apps/web build

预期：Web 测试失败数为 0，lint 无 error，build 退出码为 0；Windows standalone trace 的既有 symlink
warning 单独记录，不修改无关配置。

- [ ] Step 2：检查高亮颜色和滚动边界

启动 Web 开发服务，在 Markdown /
Word 转 PDF 页面分别输入长文档和超长单行，核对桌面与窄视口：编辑器高度不变化，纵向/横向滚动条可操作，行号和高亮文字不漂移，光标仍可见。截图只写入 artifacts/screenshots/，不提交仓库。

- [ ] Step 3：检查提交范围并收口

运行：

    git status --short
    git log -5 --oneline
    git diff --check

预期：只剩用户原有的 apps/web/package.json 修改；提交信息为中文；没有 .env\*、Docker 包、截图或生成缓存进入提交。
