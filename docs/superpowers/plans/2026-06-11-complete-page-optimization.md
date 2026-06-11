# Complete Page Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the Utils Plane web experience end to end around tool-first entry, trustworthy processing transparency, visible task state, unified workflows, and restrained professional UI.

**Architecture:** Add a small shared tool-experience layer under `apps/web/src/components/tools/` and a data catalog under `apps/web/src/lib/tools/`, then adopt it across marketing, dashboard, tool catalogs, tool detail pages, files, and tasks. Keep current processing logic intact; this is a front-end information architecture, state feedback, accessibility, and copy pass.

**Tech Stack:** Next.js App Router, React 18, TypeScript, next-intl, TanStack Query hooks, Vitest, Testing Library, Tailwind CSS v4 tokens, lucide-react.

---

## File Structure

Create:

- `apps/web/src/lib/tools/tool-metadata.ts`: canonical front-end metadata for tools, categories, processing location, retention, login, and common actions.
- `apps/web/src/components/tools/tool-trust-strip.tsx`: compact transparency strip for local/server/login/retention/recovery.
- `apps/web/src/components/tools/tool-step-rail.tsx`: four-stage workflow state display.
- `apps/web/src/components/tools/tool-page-shell.tsx`: shared shell for tool detail pages.
- `apps/web/src/components/tools/tool-catalog-grid.tsx`: grouped tool entry grid for marketing, dashboard, PDF, and Image pages.
- `apps/web/src/components/tools/result-panel.tsx`: consistent success download/result region.
- `apps/web/src/components/tools/failure-recovery-panel.tsx`: consistent failure explanation and retry/change-file actions.
- `apps/web/src/components/layout/page-section-header.tsx`: compact section header for dashboard and management pages.
- Tests for the shared units under `apps/web/src/components/tools/__tests__/`.

Modify:

- `apps/web/src/app/[locale]/(marketing)/page.tsx`
- `apps/web/src/components/layout/app-sidebar.tsx`
- `apps/web/src/components/layout/app-header.tsx`
- `apps/web/src/app/[locale]/(app)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/(app)/image/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/page.tsx`
- `apps/web/src/app/[locale]/(app)/font/page.tsx`
- `apps/web/src/app/[locale]/(app)/image/compress/page.tsx`
- `apps/web/src/app/[locale]/(app)/image/convert/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/merge/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/split/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/to-image/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/to-text/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/from-image/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/rotate/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/watermark/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/encrypt/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/compress/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/metadata/page.tsx`
- `apps/web/src/app/[locale]/(app)/pdf/rearrange/page.tsx`
- `apps/web/src/app/[locale]/(app)/files/page.tsx`
- `apps/web/src/app/[locale]/(app)/files/trash/page.tsx`
- `apps/web/src/app/[locale]/(app)/tasks/page.tsx`
- `apps/web/src/components/tools/file-dropzone.tsx`
- `apps/web/src/components/tools/processing-progress.tsx`
- `apps/web/src/components/tools/file-list.tsx`
- `apps/web/src/components/tools/download-button.tsx`
- `apps/web/messages/zh.json`
- `apps/web/messages/en.json`

---

### Task 1: Tool Metadata Catalog

**Files:**
- Create: `apps/web/src/lib/tools/tool-metadata.ts`
- Test: `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`

- [ ] **Step 1: Write the failing metadata tests**

Create `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  getToolByHref,
  groupedPdfTools,
  imageToolGroups,
  primaryToolHrefs,
} from '@/lib/tools/tool-metadata';

describe('tool metadata', () => {
  it('keeps dashboard and marketing primary tool links pointed at real app routes', () => {
    expect(primaryToolHrefs).toEqual(['/image/compress', '/pdf/merge', '/font']);
  });

  it('groups every PDF tool into a user intent category', () => {
    const hrefs = groupedPdfTools.flatMap((group) =>
      group.tools.map((tool) => tool.href)
    );

    expect(hrefs).toEqual([
      '/pdf/merge',
      '/pdf/split',
      '/pdf/rearrange',
      '/pdf/rotate',
      '/pdf/from-image',
      '/pdf/to-image',
      '/pdf/to-text',
      '/pdf/metadata',
      '/pdf/encrypt',
      '/pdf/watermark',
      '/pdf/compress',
    ]);
  });

  it('marks image compression as local-first and PDF merge as server processing', () => {
    expect(getToolByHref('/image/compress')?.processing).toBe('local-first');
    expect(getToolByHref('/pdf/merge')?.processing).toBe('server');
  });

  it('does not leave the image catalog under-explained', () => {
    expect(imageToolGroups.flatMap((group) => group.tools)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-metadata.test.ts
```

Expected: FAIL because `@/lib/tools/tool-metadata` does not exist.

- [ ] **Step 3: Implement the metadata catalog**

Create `apps/web/src/lib/tools/tool-metadata.ts`:

```ts
import {
  ArrowUpDown,
  FileText,
  ImageDown,
  Images,
  Info,
  Lock,
  Merge,
  Minimize2,
  RefreshCw,
  RotateCw,
  Scissors,
  Stamp,
  Type,
} from 'lucide-react';

export type ToolProcessing = 'local' | 'local-first' | 'server';
export type ToolRetention = 'browser-session' | 'server-24h' | 'account-files';

export interface ToolMeta {
  key: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  titleKey: string;
  descriptionKey: string;
  categoryKey: string;
  processing: ToolProcessing;
  retention: ToolRetention;
  requiresLogin: boolean;
  recommended?: boolean;
  tags: string[];
}

export interface ToolGroup {
  key: string;
  titleKey: string;
  descriptionKey: string;
  tools: ToolMeta[];
}

export const primaryToolHrefs = ['/image/compress', '/pdf/merge', '/font'];

export const imageTools: ToolMeta[] = [
  {
    key: 'imageCompress',
    href: '/image/compress',
    icon: ImageDown,
    titleKey: 'ToolCatalog.tools.imageCompress.title',
    descriptionKey: 'ToolCatalog.tools.imageCompress.description',
    categoryKey: 'ToolCatalog.categories.imageOptimize',
    processing: 'local-first',
    retention: 'browser-session',
    requiresLogin: false,
    recommended: true,
    tags: ['local', 'batch'],
  },
  {
    key: 'imageConvert',
    href: '/image/convert',
    icon: RefreshCw,
    titleKey: 'ToolCatalog.tools.imageConvert.title',
    descriptionKey: 'ToolCatalog.tools.imageConvert.description',
    categoryKey: 'ToolCatalog.categories.imageConvert',
    processing: 'local',
    retention: 'browser-session',
    requiresLogin: false,
    recommended: true,
    tags: ['local', 'format'],
  },
  {
    key: 'imageBatch',
    href: '/image/compress',
    icon: Images,
    titleKey: 'ToolCatalog.tools.imageBatch.title',
    descriptionKey: 'ToolCatalog.tools.imageBatch.description',
    categoryKey: 'ToolCatalog.categories.imageBatch',
    processing: 'local-first',
    retention: 'browser-session',
    requiresLogin: false,
    tags: ['batch', 'zip'],
  },
  {
    key: 'imageCompare',
    href: '/image/compress',
    icon: ArrowUpDown,
    titleKey: 'ToolCatalog.tools.imageCompare.title',
    descriptionKey: 'ToolCatalog.tools.imageCompare.description',
    categoryKey: 'ToolCatalog.categories.imagePreview',
    processing: 'local',
    retention: 'browser-session',
    requiresLogin: false,
    tags: ['preview', 'quality'],
  },
];

export const pdfTools: ToolMeta[] = [
  {
    key: 'pdfMerge',
    href: '/pdf/merge',
    icon: Merge,
    titleKey: 'ToolCatalog.tools.pdfMerge.title',
    descriptionKey: 'ToolCatalog.tools.pdfMerge.description',
    categoryKey: 'ToolCatalog.categories.pdfOrganize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    recommended: true,
    tags: ['combine', 'order'],
  },
  {
    key: 'pdfSplit',
    href: '/pdf/split',
    icon: Scissors,
    titleKey: 'ToolCatalog.tools.pdfSplit.title',
    descriptionKey: 'ToolCatalog.tools.pdfSplit.description',
    categoryKey: 'ToolCatalog.categories.pdfOrganize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    recommended: true,
    tags: ['pages', 'extract'],
  },
  {
    key: 'pdfRearrange',
    href: '/pdf/rearrange',
    icon: ArrowUpDown,
    titleKey: 'ToolCatalog.tools.pdfRearrange.title',
    descriptionKey: 'ToolCatalog.tools.pdfRearrange.description',
    categoryKey: 'ToolCatalog.categories.pdfOrganize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['pages', 'drag'],
  },
  {
    key: 'pdfRotate',
    href: '/pdf/rotate',
    icon: RotateCw,
    titleKey: 'ToolCatalog.tools.pdfRotate.title',
    descriptionKey: 'ToolCatalog.tools.pdfRotate.description',
    categoryKey: 'ToolCatalog.categories.pdfOrganize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['pages', 'rotation'],
  },
  {
    key: 'pdfFromImage',
    href: '/pdf/from-image',
    icon: Images,
    titleKey: 'ToolCatalog.tools.pdfFromImage.title',
    descriptionKey: 'ToolCatalog.tools.pdfFromImage.description',
    categoryKey: 'ToolCatalog.categories.pdfConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['images', 'pdf'],
  },
  {
    key: 'pdfToImage',
    href: '/pdf/to-image',
    icon: Images,
    titleKey: 'ToolCatalog.tools.pdfToImage.title',
    descriptionKey: 'ToolCatalog.tools.pdfToImage.description',
    categoryKey: 'ToolCatalog.categories.pdfConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['png', 'jpeg'],
  },
  {
    key: 'pdfToText',
    href: '/pdf/to-text',
    icon: FileText,
    titleKey: 'ToolCatalog.tools.pdfToText.title',
    descriptionKey: 'ToolCatalog.tools.pdfToText.description',
    categoryKey: 'ToolCatalog.categories.pdfConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['markdown', 'text'],
  },
  {
    key: 'pdfMetadata',
    href: '/pdf/metadata',
    icon: Info,
    titleKey: 'ToolCatalog.tools.pdfMetadata.title',
    descriptionKey: 'ToolCatalog.tools.pdfMetadata.description',
    categoryKey: 'ToolCatalog.categories.pdfConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['metadata', 'author'],
  },
  {
    key: 'pdfEncrypt',
    href: '/pdf/encrypt',
    icon: Lock,
    titleKey: 'ToolCatalog.tools.pdfEncrypt.title',
    descriptionKey: 'ToolCatalog.tools.pdfEncrypt.description',
    categoryKey: 'ToolCatalog.categories.pdfSecurity',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['password', 'permissions'],
  },
  {
    key: 'pdfWatermark',
    href: '/pdf/watermark',
    icon: Stamp,
    titleKey: 'ToolCatalog.tools.pdfWatermark.title',
    descriptionKey: 'ToolCatalog.tools.pdfWatermark.description',
    categoryKey: 'ToolCatalog.categories.pdfSecurity',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    tags: ['watermark', 'ownership'],
  },
  {
    key: 'pdfCompress',
    href: '/pdf/compress',
    icon: Minimize2,
    titleKey: 'ToolCatalog.tools.pdfCompress.title',
    descriptionKey: 'ToolCatalog.tools.pdfCompress.description',
    categoryKey: 'ToolCatalog.categories.pdfOptimize',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    recommended: true,
    tags: ['size', 'quality'],
  },
];

export const fontTools: ToolMeta[] = [
  {
    key: 'fontConvert',
    href: '/font',
    icon: Type,
    titleKey: 'ToolCatalog.tools.fontConvert.title',
    descriptionKey: 'ToolCatalog.tools.fontConvert.description',
    categoryKey: 'ToolCatalog.categories.fontConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    recommended: true,
    tags: ['ttf', 'woff2'],
  },
];

function groupByCategory(tools: ToolMeta[]): ToolGroup[] {
  const orderedKeys = Array.from(new Set(tools.map((tool) => tool.categoryKey)));
  return orderedKeys.map((categoryKey) => ({
    key: categoryKey.split('.').at(-1) ?? categoryKey,
    titleKey: categoryKey,
    descriptionKey: `${categoryKey}Description`,
    tools: tools.filter((tool) => tool.categoryKey === categoryKey),
  }));
}

export const imageToolGroups = groupByCategory(imageTools);
export const groupedPdfTools = groupByCategory(pdfTools);
export const fontToolGroups = groupByCategory(fontTools);
export const allTools = [...imageTools, ...pdfTools, ...fontTools];
export const recommendedTools = allTools.filter((tool) => tool.recommended);

export function getToolByHref(href: string): ToolMeta | undefined {
  return allTools.find((tool) => tool.href === href);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-metadata.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/lib/tools/tool-metadata.ts apps/web/src/components/tools/__tests__/tool-metadata.test.ts
git commit -m "feat(web): add tool metadata catalog"
```

---

### Task 2: Shared Tool Experience Components

**Files:**
- Create: `apps/web/src/components/tools/tool-trust-strip.tsx`
- Create: `apps/web/src/components/tools/tool-step-rail.tsx`
- Create: `apps/web/src/components/tools/tool-page-shell.tsx`
- Create: `apps/web/src/components/tools/tool-catalog-grid.tsx`
- Create: `apps/web/src/components/tools/result-panel.tsx`
- Create: `apps/web/src/components/tools/failure-recovery-panel.tsx`
- Create: `apps/web/src/components/tools/__tests__/tool-experience.test.tsx`

- [ ] **Step 1: Write the failing shared component tests**

Create `apps/web/src/components/tools/__tests__/tool-experience.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { imageTools } from '@/lib/tools/tool-metadata';
import { FailureRecoveryPanel } from '../failure-recovery-panel';
import { ResultPanel } from '../result-panel';
import { ToolCatalogGrid } from '../tool-catalog-grid';
import { ToolStepRail } from '../tool-step-rail';
import { ToolTrustStrip } from '../tool-trust-strip';

function renderWithIntl(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe('tool experience components', () => {
  it('renders processing transparency without requiring color-only meaning', () => {
    renderWithIntl(
      <ToolTrustStrip
        processing="server"
        retention="account-files"
        requiresLogin
        recovery="Retry, replace file, or inspect task details."
      />
    );

    expect(screen.getByText('Server processing')).toBeInTheDocument();
    expect(screen.getByText('Sign-in required')).toBeInTheDocument();
    expect(screen.getByText('Saved to account files')).toBeInTheDocument();
    expect(screen.getByText(/Retry, replace file/)).toBeInTheDocument();
  });

  it('labels every workflow stage and marks the current stage', () => {
    renderWithIntl(<ToolStepRail current="processing" />);

    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Result')).toBeInTheDocument();
  });

  it('renders grouped catalog links with recommended flags', () => {
    renderWithIntl(
      <ToolCatalogGrid
        groups={[
          {
            key: 'image',
            titleKey: 'ToolCatalog.categories.imageOptimize',
            descriptionKey: 'ToolCatalog.categories.imageOptimizeDescription',
            tools: imageTools.slice(0, 1),
          },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: /Image compression/ })).toHaveAttribute(
      'href',
      '/image/compress'
    );
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('gives failure recovery explicit next actions', () => {
    const retry = vi.fn();
    const reset = vi.fn();

    renderWithIntl(
      <FailureRecoveryPanel
        message="The worker could not parse this file."
        errorCode="PDF_PARSE_FAILED"
        onRetry={retry}
        onReset={reset}
      />
    );

    expect(screen.getByText('PDF_PARSE_FAILED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace file' })).toBeInTheDocument();
  });

  it('renders a result panel with a download command and file metadata', () => {
    renderWithIntl(
      <ResultPanel
        title="compressed.png"
        description="Ready to download."
        meta={[
          { label: 'Original', value: '2 MB' },
          { label: 'Result', value: '900 KB' },
        ]}
        action={<button type="button">Download</button>}
      />
    );

    expect(screen.getByText('compressed.png')).toBeInTheDocument();
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-experience.test.tsx
```

Expected: FAIL because the shared components do not exist.

- [ ] **Step 3: Implement `ToolTrustStrip`**

Create `apps/web/src/components/tools/tool-trust-strip.tsx`:

```tsx
'use client';

import { Clock3, LockKeyhole, RotateCcw, Server, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ToolProcessing, ToolRetention } from '@/lib/tools/tool-metadata';

interface ToolTrustStripProps {
  processing: ToolProcessing;
  retention: ToolRetention;
  requiresLogin: boolean;
  recovery: string;
  className?: string;
}

export function ToolTrustStrip({
  processing,
  retention,
  requiresLogin,
  recovery,
  className,
}: ToolTrustStripProps) {
  const t = useTranslations('ToolShell.trust');
  const items = [
    {
      icon: processing === 'server' ? Server : ShieldCheck,
      label: t(`processing.${processing}`),
    },
    {
      icon: Clock3,
      label: t(`retention.${retention}`),
    },
    {
      icon: LockKeyhole,
      label: requiresLogin ? t('login.required') : t('login.notRequired'),
    },
    {
      icon: RotateCcw,
      label: recovery,
    },
  ];

  return (
    <dl
      className={`grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 xl:grid-cols-4 ${className ?? ''}`}
    >
      {items.map((item) => (
        <div key={item.label} className="bg-card px-3 py-3">
          <dt className="sr-only">{item.label}</dt>
          <dd className="flex items-start gap-2 text-xs text-muted-foreground">
            <item.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" strokeWidth={1.5} />
            <span>{item.label}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 4: Implement `ToolStepRail`**

Create `apps/web/src/components/tools/tool-step-rail.tsx`:

```tsx
'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type ToolStage = 'upload' | 'configure' | 'processing' | 'result';

interface ToolStepRailProps {
  current: ToolStage;
  className?: string;
}

const stages: ToolStage[] = ['upload', 'configure', 'processing', 'result'];

export function ToolStepRail({ current, className }: ToolStepRailProps) {
  const t = useTranslations('ToolShell.steps');
  const currentIndex = stages.indexOf(current);

  return (
    <ol className={`grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-4 ${className ?? ''}`}>
      {stages.map((stage, index) => {
        const done = index < currentIndex;
        const active = stage === current;
        return (
          <li key={stage} className="bg-card px-3 py-3">
            <span
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider ${
                active ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span className={`flex h-4 w-4 items-center justify-center border text-[9px] ${
                active || done ? 'border-accent text-accent' : 'border-border'
              }`}>
                {done ? <Check className="h-3 w-3" strokeWidth={1.5} /> : index + 1}
              </span>
              {t(stage)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 5: Implement `ToolPageShell`**

Create `apps/web/src/components/tools/tool-page-shell.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { ToolProcessing, ToolRetention } from '@/lib/tools/tool-metadata';
import { ToolStage, ToolStepRail } from './tool-step-rail';
import { ToolTrustStrip } from './tool-trust-strip';

interface ToolPageShellProps {
  title: string;
  description: string;
  processing: ToolProcessing;
  retention: ToolRetention;
  requiresLogin: boolean;
  recovery: string;
  stage: ToolStage;
  children: ReactNode;
  aside?: ReactNode;
}

export function ToolPageShell({
  title,
  description,
  processing,
  retention,
  requiresLogin,
  recovery,
  stage,
  children,
  aside,
}: ToolPageShellProps) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        <ToolStepRail current={stage} />
      </div>
      <ToolTrustStrip
        processing={processing}
        retention={retention}
        requiresLogin={requiresLogin}
        recovery={recovery}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">{children}</div>
        {aside && <aside className="min-w-0 space-y-4">{aside}</aside>}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement catalog, result, and failure components**

Create `apps/web/src/components/tools/tool-catalog-grid.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ToolGroup } from '@/lib/tools/tool-metadata';

export function ToolCatalogGrid({ groups }: { groups: ToolGroup[] }) {
  const t = useTranslations();

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <div className="grid gap-1 sm:grid-cols-[220px_1fr]">
            <h2 className="text-sm font-medium">{t(group.titleKey)}</h2>
            <p className="text-xs text-muted-foreground">{t(group.descriptionKey)}</p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
            {group.tools.map((tool) => (
              <Link
                key={tool.key}
                href={tool.href}
                className="group min-h-[132px] bg-card p-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <tool.icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground" strokeWidth={1.5} />
                  {tool.recommended && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                      {t('ToolCatalog.recommended')}
                    </span>
                  )}
                </div>
                <div className="mt-4">
                  <h3 className="text-sm font-medium">{t(tool.titleKey)}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t(tool.descriptionKey)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

Create `apps/web/src/components/tools/result-panel.tsx`:

```tsx
import type { ReactNode } from 'react';

interface ResultPanelProps {
  title: string;
  description: string;
  meta?: { label: string; value: string }[];
  action: ReactNode;
}

export function ResultPanel({ title, description, meta = [], action }: ResultPanelProps) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          {meta.length > 0 && (
            <dl className="mt-3 grid gap-2 sm:grid-cols-3">
              {meta.map((item) => (
                <div key={item.label}>
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="text-xs font-mono text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </section>
  );
}
```

Create `apps/web/src/components/tools/failure-recovery-panel.tsx`:

```tsx
'use client';

import { AlertTriangle, RotateCcw, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface FailureRecoveryPanelProps {
  message: string;
  errorCode?: string;
  onRetry?: () => void;
  onReset?: () => void;
}

export function FailureRecoveryPanel({
  message,
  errorCode,
  onRetry,
  onReset,
}: FailureRecoveryPanelProps) {
  const t = useTranslations('ToolShell.failure');

  return (
    <section className="rounded-md border border-destructive/30 bg-card p-4">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-destructive">{t('title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{message}</p>
          {errorCode && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-destructive">
              {errorCode}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-mono hover:bg-muted/40"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                {t('retry')}
              </button>
            )}
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-mono hover:bg-muted/40"
              >
                <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
                {t('replaceFile')}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Add translation keys needed by tests**

Modify `apps/web/messages/en.json` by adding these top-level keys:

```json
"ToolShell": {
  "steps": {
    "upload": "Upload",
    "configure": "Configure",
    "processing": "Processing",
    "result": "Result"
  },
  "trust": {
    "processing": {
      "local": "Local processing",
      "local-first": "Local first, server optional",
      "server": "Server processing"
    },
    "retention": {
      "browser-session": "Browser session only",
      "server-24h": "Removed after 24 hours",
      "account-files": "Saved to account files"
    },
    "login": {
      "required": "Sign-in required",
      "notRequired": "No sign-in required"
    }
  },
  "failure": {
    "title": "Processing failed",
    "retry": "Retry",
    "replaceFile": "Replace file"
  }
},
"ToolCatalog": {
  "recommended": "Recommended",
  "categories": {
    "imageOptimize": "Optimize",
    "imageOptimizeDescription": "Reduce file size while keeping visual quality visible.",
    "imageConvert": "Convert",
    "imageConvertDescription": "Move between image formats without leaving the browser.",
    "imageBatch": "Batch",
    "imageBatchDescription": "Process multiple images and package the result as one download.",
    "imagePreview": "Preview",
    "imagePreviewDescription": "Compare original and result before saving.",
    "pdfOrganize": "Organize",
    "pdfOrganizeDescription": "Merge, split, reorder, and rotate pages.",
    "pdfConvert": "Convert",
    "pdfConvertDescription": "Move between PDF, image, text, and metadata workflows.",
    "pdfSecurity": "Security",
    "pdfSecurityDescription": "Apply passwords, permissions, and visible ownership marks.",
    "pdfOptimize": "Optimize",
    "pdfOptimizeDescription": "Reduce PDF file size with clear quality tradeoffs.",
    "fontConvert": "Font conversion",
    "fontConvertDescription": "Preview, subset, and convert font files."
  },
  "tools": {
    "imageCompress": { "title": "Image compression", "description": "Compress JPG, PNG, WebP, and AVIF with local-first processing." },
    "imageConvert": { "title": "Image conversion", "description": "Convert JPEG, PNG, WebP, and AVIF in the browser." },
    "imageBatch": { "title": "Batch image output", "description": "Process many images and download a single ZIP." },
    "imageCompare": { "title": "Before / after preview", "description": "Check visual quality before keeping the result." },
    "pdfMerge": { "title": "Merge PDF", "description": "Combine multiple PDF files in a controlled order." },
    "pdfSplit": { "title": "Split PDF", "description": "Extract ranges, pages, or recurring chunks." },
    "pdfRearrange": { "title": "Rearrange pages", "description": "Drag pages into a new order or remove extras." },
    "pdfRotate": { "title": "Rotate pages", "description": "Rotate all or selected PDF pages." },
    "pdfFromImage": { "title": "Image to PDF", "description": "Turn multiple images into a PDF document." },
    "pdfToImage": { "title": "PDF to image", "description": "Export PDF pages as PNG or JPEG files." },
    "pdfToText": { "title": "PDF to text", "description": "Extract text as Markdown or plain text." },
    "pdfMetadata": { "title": "Edit metadata", "description": "Review and update title, author, and keyword fields." },
    "pdfEncrypt": { "title": "Encrypt PDF", "description": "Set an open password and permissions." },
    "pdfWatermark": { "title": "Add watermark", "description": "Apply visible ownership text across the document." },
    "pdfCompress": { "title": "Compress PDF", "description": "Reduce PDF size with explicit quality levels." },
    "fontConvert": { "title": "Font conversion", "description": "Convert TTF, OTF, WOFF, and WOFF2 after sign-in." }
  }
}
```

Modify `apps/web/messages/zh.json` with the same key tree and Chinese values:

```json
"ToolShell": {
  "steps": {
    "upload": "上传",
    "configure": "配置",
    "processing": "处理中",
    "result": "结果"
  },
  "trust": {
    "processing": {
      "local": "本地处理",
      "local-first": "本地优先，可切到服务端",
      "server": "服务端处理"
    },
    "retention": {
      "browser-session": "仅保留在当前浏览器会话",
      "server-24h": "24 小时后删除",
      "account-files": "保存到账号文件"
    },
    "login": {
      "required": "需要登录",
      "notRequired": "无需登录"
    }
  },
  "failure": {
    "title": "处理失败",
    "retry": "重试",
    "replaceFile": "更换文件"
  }
},
"ToolCatalog": {
  "recommended": "推荐",
  "categories": {
    "imageOptimize": "优化",
    "imageOptimizeDescription": "在保持视觉质量的同时降低文件大小。",
    "imageConvert": "转换",
    "imageConvertDescription": "在浏览器中完成图片格式互转。",
    "imageBatch": "批量",
    "imageBatchDescription": "一次处理多张图片，并打包下载结果。",
    "imagePreview": "预览",
    "imagePreviewDescription": "保存前对比原图和处理结果。",
    "pdfOrganize": "整理",
    "pdfOrganizeDescription": "合并、拆分、重排和旋转页面。",
    "pdfConvert": "转换",
    "pdfConvertDescription": "在 PDF、图片、文本和元数据流程间转换。",
    "pdfSecurity": "安全",
    "pdfSecurityDescription": "添加密码、权限和可见归属标记。",
    "pdfOptimize": "优化",
    "pdfOptimizeDescription": "用明确质量档位降低 PDF 文件大小。",
    "fontConvert": "字体转换",
    "fontConvertDescription": "预览、子集化并转换字体文件。"
  },
  "tools": {
    "imageCompress": { "title": "图片压缩", "description": "本地优先压缩 JPG、PNG、WebP 和 AVIF。" },
    "imageConvert": { "title": "图片转换", "description": "在浏览器中转换 JPEG、PNG、WebP 和 AVIF。" },
    "imageBatch": { "title": "批量图片输出", "description": "处理多张图片并下载一个 ZIP。" },
    "imageCompare": { "title": "前后对比预览", "description": "保留结果前检查视觉质量。" },
    "pdfMerge": { "title": "合并 PDF", "description": "按可控顺序合并多个 PDF 文件。" },
    "pdfSplit": { "title": "拆分 PDF", "description": "按范围、页码或固定间隔提取页面。" },
    "pdfRearrange": { "title": "页面重排", "description": "拖拽调整页面顺序或移除多余页面。" },
    "pdfRotate": { "title": "旋转页面", "description": "旋转全部或选中的 PDF 页面。" },
    "pdfFromImage": { "title": "图片转 PDF", "description": "将多张图片转成一个 PDF 文档。" },
    "pdfToImage": { "title": "PDF 转图片", "description": "将 PDF 页面导出为 PNG 或 JPEG。" },
    "pdfToText": { "title": "PDF 转文本", "description": "提取 Markdown 或纯文本内容。" },
    "pdfMetadata": { "title": "编辑元数据", "description": "查看并修改标题、作者和关键词。" },
    "pdfEncrypt": { "title": "加密 PDF", "description": "设置打开密码与权限控制。" },
    "pdfWatermark": { "title": "添加水印", "description": "为文档添加可见归属文字。" },
    "pdfCompress": { "title": "压缩 PDF", "description": "用明确质量档位降低 PDF 大小。" },
    "fontConvert": { "title": "字体转换", "description": "登录后转换 TTF、OTF、WOFF 和 WOFF2。" }
  }
}
```

- [ ] **Step 8: Run the shared component tests**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-experience.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add apps/web/src/components/tools/tool-trust-strip.tsx apps/web/src/components/tools/tool-step-rail.tsx apps/web/src/components/tools/tool-page-shell.tsx apps/web/src/components/tools/tool-catalog-grid.tsx apps/web/src/components/tools/result-panel.tsx apps/web/src/components/tools/failure-recovery-panel.tsx apps/web/src/components/tools/__tests__/tool-experience.test.tsx apps/web/messages/en.json apps/web/messages/zh.json
git commit -m "feat(web): add shared tool experience components"
```

---

### Task 3: Upload And Progress Visibility

**Files:**
- Modify: `apps/web/src/components/tools/file-dropzone.tsx`
- Modify: `apps/web/src/components/tools/processing-progress.tsx`
- Test: `apps/web/src/components/tools/__tests__/file-dropzone.test.tsx`
- Test: `apps/web/src/components/tools/__tests__/processing-progress.test.tsx`

- [ ] **Step 1: Write failing tests for structured upload metadata**

Create `apps/web/src/components/tools/__tests__/file-dropzone.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { FileDropzone } from '../file-dropzone';

function renderDropzone() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <FileDropzone
        accept={{ 'image/*': ['.jpg', '.png'] }}
        maxSize={50 * 1024 * 1024}
        multiple
        onDrop={vi.fn()}
        hint="JPG / PNG"
        processingLabel="Local first"
      />
    </NextIntlClientProvider>
  );
}

describe('FileDropzone', () => {
  it('shows accepted formats, max size, and processing location as stable metadata', () => {
    renderDropzone();

    expect(screen.getByText('JPG / PNG')).toBeInTheDocument();
    expect(screen.getByText('50 MB max')).toBeInTheDocument();
    expect(screen.getByText('Local first')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write failing tests for progress stages**

Create `apps/web/src/components/tools/__tests__/processing-progress.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../../messages/en.json';
import { ProcessingProgress } from '../processing-progress';

describe('ProcessingProgress', () => {
  it('shows a stage label and bounded percent', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProcessingProgress progress={143} stage="generating" />
      </NextIntlClientProvider>
    );

    expect(screen.getByText('Generating result')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/file-dropzone.test.tsx src/components/tools/__tests__/processing-progress.test.tsx
```

Expected: FAIL because `processingLabel` and `stage` props are missing.

- [ ] **Step 4: Extend `FileDropzone`**

Modify the prop interface in `apps/web/src/components/tools/file-dropzone.tsx`:

```ts
export interface FileDropzoneProps {
  accept?: Accept;
  maxSize?: number;
  multiple?: boolean;
  disabled?: boolean;
  onDrop: (files: File[]) => void;
  className?: string;
  hint?: string;
  processingLabel?: string;
}
```

Add this helper above the component:

```ts
function formatMaxSize(bytes?: number): string | null {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb)} MB max`;
  return `${Math.round(bytes / 1024)} KB max`;
}
```

Destructure `processingLabel`, compute `maxSizeLabel`, and replace the single hint line with:

```tsx
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-mono text-muted-foreground">
          {hint && <span>{hint}</span>}
          {maxSizeLabel && <span>{maxSizeLabel}</span>}
          {processingLabel && <span>{processingLabel}</span>}
        </div>
```

- [ ] **Step 5: Extend `ProcessingProgress`**

Modify `apps/web/src/components/tools/processing-progress.tsx`:

```tsx
export type ProcessingStage = 'uploading' | 'queued' | 'processing' | 'generating';

export interface ProcessingProgressProps {
  progress: number;
  label?: string;
  stage?: ProcessingStage;
  className?: string;
}
```

Inside the component add:

```tsx
  const stageLabel = stage ? t(`stages.${stage}`) : undefined;
```

Replace the rendered label expression with:

```tsx
          {label ?? stageLabel ?? t('processing')}
```

- [ ] **Step 6: Add progress translation keys**

Add under `ToolsShared` in both message files.

English:

```json
"stages": {
  "uploading": "Uploading",
  "queued": "Queued",
  "processing": "Processing",
  "generating": "Generating result"
}
```

Chinese:

```json
"stages": {
  "uploading": "上传中",
  "queued": "排队中",
  "processing": "处理中",
  "generating": "生成结果"
}
```

- [ ] **Step 7: Run both tests to verify they pass**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/file-dropzone.test.tsx src/components/tools/__tests__/processing-progress.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/web/src/components/tools/file-dropzone.tsx apps/web/src/components/tools/processing-progress.tsx apps/web/src/components/tools/__tests__/file-dropzone.test.tsx apps/web/src/components/tools/__tests__/processing-progress.test.tsx apps/web/messages/en.json apps/web/messages/zh.json
git commit -m "feat(web): expose upload and processing state metadata"
```

---

### Task 4: Navigation, Marketing, And Dashboard

**Files:**
- Modify: `apps/web/src/components/layout/app-sidebar.tsx`
- Modify: `apps/web/src/components/layout/app-header.tsx`
- Modify: `apps/web/src/app/[locale]/(marketing)/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/dashboard/page.tsx`
- Create: `apps/web/src/components/layout/page-section-header.tsx`
- Test: `apps/web/src/app/[locale]/__tests__/metadata.test.ts`

- [ ] **Step 1: Write a failing route integrity test**

Extend `apps/web/src/app/[locale]/__tests__/metadata.test.ts` with:

```ts
import { primaryToolHrefs } from '@/lib/tools/tool-metadata';

it('does not point primary tool journeys at missing documentation routes', () => {
  expect(primaryToolHrefs).not.toContain('/docs');
  expect(primaryToolHrefs).toContain('/image/compress');
  expect(primaryToolHrefs).toContain('/pdf/merge');
  expect(primaryToolHrefs).toContain('/font');
});
```

- [ ] **Step 2: Run the route integrity test**

Run:

```bash
bun --cwd apps/web test src/app/[locale]/__tests__/metadata.test.ts
```

Expected: PASS if Task 1 is complete. This test guards the page edits.

- [ ] **Step 3: Add Dashboard to the sidebar**

Modify `apps/web/src/components/layout/app-sidebar.tsx` imports:

```tsx
import {
  Image,
  FileType,
  Type,
  FolderOpen,
  History,
  LayoutDashboard,
} from "lucide-react";
```

Modify `navigation`:

```tsx
const navigation = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "imageTools", href: "/image", icon: Image },
  { key: "pdfTools", href: "/pdf", icon: FileType },
  { key: "fontTools", href: "/font", icon: Type },
  { key: "myFiles", href: "/files", icon: FolderOpen },
  { key: "taskHistory", href: "/tasks", icon: History },
] as const;
```

- [ ] **Step 4: Update Header home label target**

In `apps/web/src/components/layout/app-header.tsx`, keep the breadcrumb home target as `/dashboard` but change the `AppLayout.home` translation to `Dashboard` and `仪表盘` in message files, so the app shell no longer calls Dashboard "Home".

- [ ] **Step 5: Create `PageSectionHeader`**

Create `apps/web/src/components/layout/page-section-header.tsx`:

```tsx
interface PageSectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function PageSectionHeader({
  eyebrow,
  title,
  description,
  action,
}: PageSectionHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-xl font-medium tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
```

- [ ] **Step 6: Rewrite marketing page around tool entry**

In `apps/web/src/app/[locale]/(marketing)/page.tsx`:

1. Remove the `/docs` CTA.
2. Import `ToolCatalogGrid`, `recommendedTools`, and `ToolGroup`.
3. Build one group from `recommendedTools`.
4. Make the primary CTA link to `/image/compress`.
5. Use copy that states "local-first where possible, server processing where needed".

Use this group code inside the page:

```tsx
const recommendedGroup = [
  {
    key: 'recommended',
    titleKey: 'Marketing.tools.heading',
    descriptionKey: 'Marketing.tools.description',
    tools: recommendedTools,
  },
] satisfies ToolGroup[];
```

- [ ] **Step 7: Replace dashboard zero stats with real hooks and empty states**

In `apps/web/src/app/[locale]/(app)/dashboard/page.tsx`:

1. Convert to a client component.
2. Import `useFiles`, `useTasks`, `ToolCatalogGrid`, `recommendedTools`, and `PageSectionHeader`.
3. Render recommended tools.
4. Render recent tasks from `useTasks({ page: 1, limit: 5 })`.
5. Render recent files from `useFiles({ page: 1, limit: 5 })`.
6. Render a failed-task strip from tasks where `status === 'failed'`.
7. When data is empty, show written empty states instead of numeric cards.

Use this task filter:

```tsx
const failedTasks = tasks.filter((task) => task.status === 'failed');
```

- [ ] **Step 8: Add dashboard and marketing copy**

Add keys to `Marketing.tools`, `Dashboard.sections`, `Dashboard.empty`, and `Dashboard.actions` in both message files. Do not claim all processing is local.

- [ ] **Step 9: Run tests and commit**

Run:

```bash
bun --cwd apps/web test src/app/[locale]/__tests__/metadata.test.ts
```

Expected: PASS.

Run:

```bash
git add apps/web/src/components/layout/app-sidebar.tsx apps/web/src/components/layout/app-header.tsx apps/web/src/components/layout/page-section-header.tsx apps/web/src/app/[locale]/\\(marketing\\)/page.tsx apps/web/src/app/[locale]/\\(app\\)/dashboard/page.tsx apps/web/messages/en.json apps/web/messages/zh.json apps/web/src/app/[locale]/__tests__/metadata.test.ts
git commit -m "feat(web): make entry pages tool-first"
```

---

### Task 5: Catalog Pages

**Files:**
- Modify: `apps/web/src/app/[locale]/(app)/image/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/pdf/page.tsx`

- [ ] **Step 1: Add grouped image catalog**

Replace the image page custom two-card grid with:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { PageSectionHeader } from '@/components/layout/page-section-header';
import { ToolCatalogGrid } from '@/components/tools/tool-catalog-grid';
import { ToolTrustStrip } from '@/components/tools/tool-trust-strip';
import { imageToolGroups } from '@/lib/tools/tool-metadata';

export default function ImagePage() {
  const t = useTranslations('ImageTool');
  const tShell = useTranslations('ToolShell');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageSectionHeader title={t('title')} description={t('description')} />
      <ToolTrustStrip
        processing="local-first"
        retention="browser-session"
        requiresLogin={false}
        recovery={tShell('catalogRecovery')}
      />
      <ToolCatalogGrid groups={imageToolGroups} />
    </div>
  );
}
```

- [ ] **Step 2: Add grouped PDF catalog**

Replace the PDF page flat grid with:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { PageSectionHeader } from '@/components/layout/page-section-header';
import { ToolCatalogGrid } from '@/components/tools/tool-catalog-grid';
import { ToolTrustStrip } from '@/components/tools/tool-trust-strip';
import { groupedPdfTools } from '@/lib/tools/tool-metadata';

export default function PdfPage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageSectionHeader title={t('title')} description={t('description')} />
      <ToolTrustStrip
        processing="server"
        retention="account-files"
        requiresLogin
        recovery={tShell('catalogRecovery')}
      />
      <ToolCatalogGrid groups={groupedPdfTools} />
    </div>
  );
}
```

- [ ] **Step 3: Add shared catalog recovery copy**

Add to both message files:

English:

```json
"catalogRecovery": "Retry, replace files, or review task history when processing fails."
```

Chinese:

```json
"catalogRecovery": "处理失败后可重试、更换文件或查看任务记录。"
```

Place it inside `ToolShell`.

- [ ] **Step 4: Run metadata and component tests**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-metadata.test.ts src/components/tools/__tests__/tool-experience.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/app/[locale]/\\(app\\)/image/page.tsx apps/web/src/app/[locale]/\\(app\\)/pdf/page.tsx apps/web/messages/en.json apps/web/messages/zh.json
git commit -m "feat(web): group tool catalog pages by intent"
```

---

### Task 6: Tool Detail Page Shell Adoption

**Files:**
- Modify every tool detail page listed in the File Structure section.

- [ ] **Step 1: Add a local stage helper to each detail page**

In each tool detail page, add this helper near local state declarations and adapt variable names to the page state:

```tsx
const stage =
  result
    ? 'result'
    : processing
      ? 'processing'
      : file || files.length > 0 || items.length > 0
        ? 'configure'
        : 'upload';
```

For pages with only `file`, use:

```tsx
const stage = result ? 'result' : processing ? 'processing' : file ? 'configure' : 'upload';
```

For image compress with `items`, use:

```tsx
const stage = hasAnyResult ? 'result' : processing ? 'processing' : items.length > 0 ? 'configure' : 'upload';
```

- [ ] **Step 2: Wrap image compression**

In `apps/web/src/app/[locale]/(app)/image/compress/page.tsx`:

1. Import `ToolPageShell`, `ResultPanel`, `FailureRecoveryPanel`, and `getToolByHref`.
2. Read `const tool = getToolByHref('/image/compress')!;`.
3. Wrap the existing rendered content in `ToolPageShell`.
4. Pass `processing={tool.processing}`, `retention={tool.retention}`, and `requiresLogin={tool.requiresLogin}`.
5. Pass `processingLabel={mode === 'local' ? tShared('mode.local') : tShared('mode.server')}` to `FileDropzone`.
6. Replace the raw `globalError` block with `FailureRecoveryPanel`.
7. Wrap the download area in `ResultPanel`.

Use this shell opening:

```tsx
<ToolPageShell
  title={t('title')}
  description={t('description')}
  processing={tool.processing}
  retention={tool.retention}
  requiresLogin={tool.requiresLogin}
  recovery={tShell('catalogRecovery')}
  stage={stage}
>
```

- [ ] **Step 3: Wrap image conversion**

Apply the same structure to `apps/web/src/app/[locale]/(app)/image/convert/page.tsx` using:

```tsx
const tool = getToolByHref('/image/convert')!;
```

Use `stage = result ? 'result' : processing ? 'processing' : file ? 'configure' : 'upload';`.

- [ ] **Step 4: Wrap font conversion**

In `apps/web/src/app/[locale]/(app)/font/page.tsx`:

1. Use `const tool = getToolByHref('/font')!;`.
2. Wrap the page with `ToolPageShell`.
3. Pass `processingLabel={tShell('trust.processing.server')}` to `FileDropzone`.
4. Add a compact sign-in note above the convert button when `!session`.
5. Replace the raw error block with `FailureRecoveryPanel`.
6. Wrap result download in `ResultPanel`.

- [ ] **Step 5: Wrap all PDF pages with exact metadata**

Apply `ToolPageShell`, `FailureRecoveryPanel`, `ResultPanel`, and `processingLabel={tShell('trust.processing.server')}` to these exact pairs:

```ts
[
  ['/pdf/merge', 'apps/web/src/app/[locale]/(app)/pdf/merge/page.tsx'],
  ['/pdf/split', 'apps/web/src/app/[locale]/(app)/pdf/split/page.tsx'],
  ['/pdf/to-image', 'apps/web/src/app/[locale]/(app)/pdf/to-image/page.tsx'],
  ['/pdf/to-text', 'apps/web/src/app/[locale]/(app)/pdf/to-text/page.tsx'],
  ['/pdf/from-image', 'apps/web/src/app/[locale]/(app)/pdf/from-image/page.tsx'],
  ['/pdf/rotate', 'apps/web/src/app/[locale]/(app)/pdf/rotate/page.tsx'],
  ['/pdf/watermark', 'apps/web/src/app/[locale]/(app)/pdf/watermark/page.tsx'],
  ['/pdf/encrypt', 'apps/web/src/app/[locale]/(app)/pdf/encrypt/page.tsx'],
  ['/pdf/compress', 'apps/web/src/app/[locale]/(app)/pdf/compress/page.tsx'],
  ['/pdf/metadata', 'apps/web/src/app/[locale]/(app)/pdf/metadata/page.tsx'],
  ['/pdf/rearrange', 'apps/web/src/app/[locale]/(app)/pdf/rearrange/page.tsx'],
]
```

Each page must call `getToolByHref(href)!` with its route and pass its existing title and description translation.

- [ ] **Step 6: Preserve existing processing behavior**

For every edited detail page, keep existing upload, task creation, polling, preview, and download code. Only change layout, transparency text, progress stage prop, error panel, and result panel.

- [ ] **Step 7: Run representative tests**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-experience.test.tsx src/components/tools/__tests__/file-list.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/web/src/app/[locale]/\\(app\\)/image/compress/page.tsx apps/web/src/app/[locale]/\\(app\\)/image/convert/page.tsx apps/web/src/app/[locale]/\\(app\\)/font/page.tsx apps/web/src/app/[locale]/\\(app\\)/pdf/*.tsx apps/web/messages/en.json apps/web/messages/zh.json
git commit -m "feat(web): unify tool detail workflows"
```

---

### Task 7: Files And Tasks Management Polish

**Files:**
- Modify: `apps/web/src/app/[locale]/(app)/files/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/files/trash/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/tasks/page.tsx`
- Modify: `apps/web/src/components/tools/file-list.tsx`
- Modify: `apps/web/src/components/tools/download-button.tsx`
- Test: `apps/web/src/components/tools/__tests__/file-list.test.tsx`

- [ ] **Step 1: Extend file-list accessibility tests**

Add to `apps/web/src/components/tools/__tests__/file-list.test.tsx`:

```tsx
it('labels remove buttons with the source filename', () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <FileList
        items={[
          {
            file: new File(['content'], 'source.png', { type: 'image/png' }),
            status: 'pending',
          },
        ]}
        onRemove={() => undefined}
      />
    </NextIntlClientProvider>
  );

  expect(screen.getByRole('button', { name: 'Remove source.png' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/file-list.test.tsx
```

Expected: FAIL because remove buttons do not have accessible names.

- [ ] **Step 3: Add aria labels to shared file and download controls**

In `FileList`, add this prop to both remove buttons:

```tsx
aria-label={t('fileList.removeFile', { filename: item.file.name })}
```

In `DownloadButton`, add:

```tsx
aria-label={t('downloadFile', { filename: file.name })}
```

- [ ] **Step 4: Add Files page icon button labels**

In `apps/web/src/app/[locale]/(app)/files/page.tsx`, add:

```tsx
aria-label={t('downloadFile', { filename: file.filename })}
```

to each download icon button and:

```tsx
aria-label={t('deleteFile', { filename: file.filename })}
```

to each delete icon button.

Add labels to view toggle buttons:

```tsx
aria-label={t('gridView')}
aria-label={t('listView')}
```

- [ ] **Step 5: Make batch actions a stable toolbar**

Replace the conditional batch action block with a `role="toolbar"` container that stays mounted and uses `opacity-0 pointer-events-none` when `selected.size === 0`. Keep the selected count text visible only when count is positive.

- [ ] **Step 6: Improve task detail panel copy**

In `apps/web/src/app/[locale]/(app)/tasks/page.tsx`, change `TaskDetailPanel` so it renders:

- Input files as a count plus shortened IDs.
- Output file with a download cue when present.
- Parameter summary using label rows instead of raw JSON.
- Failure reason and suggested action when `task.errorCode` exists.

Use this summary formatter above `TaskDetailPanel`:

```ts
function formatConfigSummary(config: Record<string, unknown> | null | undefined): string[] {
  if (!config) return [];
  return Object.entries(config).map(([key, value]) => `${key}: ${String(value)}`);
}
```

- [ ] **Step 7: Add management translations**

Add to `ToolsShared.fileList`:

English:

```json
"removeFile": "Remove {filename}"
```

Chinese:

```json
"removeFile": "移除 {filename}"
```

Add to `ToolsShared`:

English:

```json
"downloadFile": "Download {filename}"
```

Chinese:

```json
"downloadFile": "下载 {filename}"
```

Add to `FilesTool`:

English:

```json
"downloadFile": "Download {filename}",
"deleteFile": "Delete {filename}"
```

Chinese:

```json
"downloadFile": "下载 {filename}",
"deleteFile": "删除 {filename}"
```

Add task detail labels to `TasksTool`: `parameterSummary`, `failureReason`, `suggestedAction`, `tryAgainOrReplace`.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/file-list.test.tsx
```

Expected: PASS.

Run:

```bash
git add apps/web/src/app/[locale]/\\(app\\)/files/page.tsx apps/web/src/app/[locale]/\\(app\\)/files/trash/page.tsx apps/web/src/app/[locale]/\\(app\\)/tasks/page.tsx apps/web/src/components/tools/file-list.tsx apps/web/src/components/tools/download-button.tsx apps/web/src/components/tools/__tests__/file-list.test.tsx apps/web/messages/en.json apps/web/messages/zh.json
git commit -m "feat(web): improve file and task management clarity"
```

---

### Task 8: Final Verification

**Files:**
- Verify all files changed by Tasks 1-7.

- [ ] **Step 1: Run full web tests**

Run:

```bash
bun --cwd apps/web test
```

Expected: all tests pass with exit code 0.

- [ ] **Step 2: Run the web build**

Run:

```bash
bun --cwd apps/web build
```

Expected: build exits with code 0.

- [ ] **Step 3: Run formatting check**

Run:

```bash
bun run format:check
```

Expected: no formatting failures. If CRLF policy failures appear, fix only files touched by this plan with Prettier and rerun.

- [ ] **Step 4: Manual UI sweep**

Start the dev server:

```bash
bun --cwd apps/web dev
```

Open these routes in desktop and mobile widths:

- `/zh`
- `/zh/dashboard`
- `/zh/image`
- `/zh/image/compress`
- `/zh/image/convert`
- `/zh/pdf`
- `/zh/pdf/merge`
- `/zh/pdf/split`
- `/zh/pdf/compress`
- `/zh/font`
- `/zh/files`
- `/zh/tasks`

Confirm:

- no console errors,
- no text overlap,
- no dead `/docs` CTA,
- Dashboard is present in the sidebar,
- every inspected tool page shows processing location, retention, login requirement, workflow stage, and failure recovery affordance.

- [ ] **Step 5: Commit final fixes**

If verification required small fixes:

```bash
git add apps/web
git commit -m "fix(web): resolve page optimization verification issues"
```

If verification required no fixes, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Tool-first entry: Tasks 4 and 5.
- Trust transparency: Tasks 2, 3, 5, and 6.
- Visible states: Tasks 2, 3, 6, and 7.
- Unified flow: Tasks 2 and 6.
- Professional restraint: Tasks 4, 5, 6, and final manual sweep.
- Files and tasks clarity: Task 7.
- i18n and mojibake avoidance: Tasks 2, 3, 4, 5, and 7.

Deferred-content scan:

- No deferred sections.
- No undefined file targets.
- No fake data requirements.

Type consistency:

- `ToolProcessing`, `ToolRetention`, and `ToolStage` are defined before use.
- `ToolGroup` and `ToolMeta` are defined in the metadata task before catalog usage.
- Translation namespaces match the components that consume them.
