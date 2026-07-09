# Image Stitch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/image/stitch` as a browser-local long image stitching tool with a free anonymous tier and logged-in commercial feature surface.

**Architecture:** Add a focused canvas processing module, an image-specific sortable list component, a client page that reuses the existing tool shell, and catalog/i18n entries. Entitlements are modeled in front-end code first so future paid plans can map into the same shape without changing page logic.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript strict mode, Tailwind CSS, next-intl, Vitest, Testing Library, `@dnd-kit`, browser canvas APIs.

---

## File Structure

- Create `apps/web/src/lib/processing/image-stitch-client.ts`
  - Owns image loading, stitch layout calculation, canvas drawing, output file naming, and entitlement defaults.
- Create `apps/web/src/lib/processing/__tests__/image-stitch-client.test.ts`
  - Tests pure layout, output naming, entitlement limits, and oversized canvas validation.
- Create `apps/web/src/components/tools/sortable-image-list.tsx`
  - Owns image thumbnail list display, drag sorting, order numbering, and removal.
- Create `apps/web/src/components/tools/__tests__/sortable-image-list.test.tsx`
  - Tests display and remove behavior. Drag mechanics are covered by relying on `@dnd-kit` and keeping reorder callback wiring simple.
- Create `apps/web/src/app/[locale]/(app)/image/stitch/page.tsx`
  - Owns upload/config/result workflow for the tool page.
- Modify `apps/web/src/lib/tools/tool-metadata.ts`
  - Adds `imageStitch` catalog entry and image composition category.
- Modify `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`
  - Updates image catalog expectations and verifies stitch metadata.
- Modify `apps/web/messages/zh.json`
  - Adds Chinese catalog and page strings.
- Modify `apps/web/messages/en.json`
  - Adds English catalog and page strings.

## Task 1: Processing Module

**Files:**
- Create: `apps/web/src/lib/processing/image-stitch-client.ts`
- Test: `apps/web/src/lib/processing/__tests__/image-stitch-client.test.ts`

- [ ] **Step 1: Write the failing processing tests**

Create `apps/web/src/lib/processing/__tests__/image-stitch-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_STITCH_LIMITS,
  buildImageStitchLayout,
  getImageStitchEntitlements,
  getStitchOutputName,
  validateImageStitchLayout,
  type ImageStitchSource,
} from '../image-stitch-client';

const sources: ImageStitchSource[] = [
  { width: 1000, height: 500 },
  { width: 500, height: 1000 },
];

describe('image stitch client helpers', () => {
  it('scales every image to the target width and sums vertical height with gaps', () => {
    const layout = buildImageStitchLayout(sources, {
      width: 500,
      gap: 10,
      background: '#ffffff',
      outputType: 'image/png',
      quality: 0.92,
      filename: 'details',
    });

    expect(layout.width).toBe(500);
    expect(layout.height).toBe(1510);
    expect(layout.items).toEqual([
      { sourceIndex: 0, x: 0, y: 0, width: 500, height: 250 },
      { sourceIndex: 1, x: 0, y: 260, width: 500, height: 1000 },
    ]);
  });

  it('uses a white background when exporting transparent settings to jpeg', () => {
    const layout = buildImageStitchLayout(sources, {
      width: 500,
      gap: 0,
      background: 'transparent',
      outputType: 'image/jpeg',
      quality: 0.86,
      filename: 'details',
    });

    expect(layout.background).toBe('#ffffff');
  });

  it('builds stable output names from the requested format', () => {
    expect(getStitchOutputName('launch-page', 'image/jpeg')).toBe(
      'launch-page.jpg'
    );
    expect(getStitchOutputName('', 'image/webp')).toBe(
      'stitched-long-image.webp'
    );
  });

  it('rejects layouts above the current entitlement pixel limit', () => {
    const layout = buildImageStitchLayout([{ width: 1, height: 1 }], {
      width: 20000,
      gap: 0,
      background: '#ffffff',
      outputType: 'image/png',
      quality: 0.92,
      filename: 'too-large',
    });

    expect(() =>
      validateImageStitchLayout(layout, {
        ...DEFAULT_IMAGE_STITCH_LIMITS.free,
        maxCanvasPixels: 1000,
      })
    ).toThrow('Canvas is too large for the current plan');
  });

  it('gives logged-in users commercial feature flags and higher limits', () => {
    expect(getImageStitchEntitlements(null)).toMatchObject({
      isLoggedIn: false,
      canBatchExport: false,
      canUseBrandFooter: false,
    });

    expect(getImageStitchEntitlements({ user: { id: 'u1' } })).toMatchObject({
      isLoggedIn: true,
      canBatchExport: true,
      canUseBrandFooter: true,
    });
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
bun --cwd apps/web test -- src/lib/processing/__tests__/image-stitch-client.test.ts
```

Expected: FAIL because `image-stitch-client.ts` does not exist.

- [ ] **Step 3: Implement the processing helpers**

Create `apps/web/src/lib/processing/image-stitch-client.ts` with:

```ts
export type ImageStitchOutputType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp';

export interface ImageStitchOptions {
  width: number;
  gap: number;
  background: string;
  outputType: ImageStitchOutputType;
  quality: number;
  filename: string;
  brandFooter?: string;
}

export interface ImageStitchSource {
  width: number;
  height: number;
}

export interface ImageStitchLayoutItem {
  sourceIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageStitchLayout {
  width: number;
  height: number;
  background: string;
  items: ImageStitchLayoutItem[];
}

export interface ImageStitchPlanLimits {
  maxFiles: number;
  maxFileSize: number;
  maxCanvasPixels: number;
}

export interface ImageStitchEntitlements extends ImageStitchPlanLimits {
  isLoggedIn: boolean;
  canBatchExport: boolean;
  canUseBrandFooter: boolean;
  canUseWatermarkTemplate: boolean;
  canSaveHistory: boolean;
}

export const DEFAULT_IMAGE_STITCH_LIMITS = {
  free: {
    maxFiles: 12,
    maxFileSize: 10 * 1024 * 1024,
    maxCanvasPixels: 32_000_000,
  },
  commercial: {
    maxFiles: 40,
    maxFileSize: 50 * 1024 * 1024,
    maxCanvasPixels: 96_000_000,
  },
} satisfies Record<string, ImageStitchPlanLimits>;

export function getImageStitchEntitlements(
  session: unknown
): ImageStitchEntitlements {
  const isLoggedIn = Boolean(session);
  const limits = isLoggedIn
    ? DEFAULT_IMAGE_STITCH_LIMITS.commercial
    : DEFAULT_IMAGE_STITCH_LIMITS.free;

  return {
    ...limits,
    isLoggedIn,
    canBatchExport: isLoggedIn,
    canUseBrandFooter: isLoggedIn,
    canUseWatermarkTemplate: isLoggedIn,
    canSaveHistory: isLoggedIn,
  };
}

export function getStitchOutputName(
  filename: string,
  outputType: ImageStitchOutputType
): string {
  const safeBase = filename.trim().replace(/\.[^.]+$/, '');
  const base = safeBase.length > 0 ? safeBase : 'stitched-long-image';
  const ext =
    outputType === 'image/jpeg' ? 'jpg' : outputType.replace('image/', '');
  return `${base}.${ext}`;
}

export function buildImageStitchLayout(
  sources: ImageStitchSource[],
  options: ImageStitchOptions
): ImageStitchLayout {
  const width = Math.max(1, Math.round(options.width));
  const gap = Math.max(0, Math.round(options.gap));
  const items: ImageStitchLayoutItem[] = [];
  let y = 0;

  sources.forEach((source, sourceIndex) => {
    const ratio = width / source.width;
    const height = Math.max(1, Math.round(source.height * ratio));
    items.push({ sourceIndex, x: 0, y, width, height });
    y += height + gap;
  });

  const height = items.length > 0 ? y - gap : 0;
  const background =
    options.outputType === 'image/jpeg' && options.background === 'transparent'
      ? '#ffffff'
      : options.background;

  return { width, height, background, items };
}

export function validateImageStitchLayout(
  layout: ImageStitchLayout,
  limits: ImageStitchPlanLimits
): void {
  if (layout.width * layout.height > limits.maxCanvasPixels) {
    throw new Error('Canvas is too large for the current plan');
  }
}

export async function stitchImages(
  files: File[],
  options: ImageStitchOptions,
  limits: ImageStitchPlanLimits
): Promise<File> {
  const images = await Promise.all(files.map(loadImage));
  const layout = buildImageStitchLayout(
    images.map(image => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
    options
  );
  validateImageStitchLayout(layout, limits);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  if (layout.background !== 'transparent') {
    ctx.fillStyle = layout.background;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }

  layout.items.forEach(item => {
    const image = images[item.sourceIndex]!;
    ctx.drawImage(image, item.x, item.y, item.width, item.height);
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      result => {
        if (!result) return reject(new Error('Image stitch export failed'));
        resolve(result);
      },
      options.outputType,
      options.outputType === 'image/png' ? undefined : options.quality
    );
  });

  return new File([blob], getStitchOutputName(options.filename, options.outputType), {
    type: blob.type || options.outputType,
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  const image = new Image();
  const url = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    image.src = url;
  });
}
```

- [ ] **Step 4: Run processing tests**

Run:

```bash
bun --cwd apps/web test -- src/lib/processing/__tests__/image-stitch-client.test.ts
```

Expected: PASS.

## Task 2: Sortable Image List

**Files:**
- Create: `apps/web/src/components/tools/sortable-image-list.tsx`
- Test: `apps/web/src/components/tools/__tests__/sortable-image-list.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `apps/web/src/components/tools/__tests__/sortable-image-list.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  SortableImageList,
  type SortableImageFile,
} from '../sortable-image-list';

function makeFile(name: string, size: number) {
  return new File(['x'.repeat(size)], name, { type: 'image/png' });
}

const files: SortableImageFile[] = [
  { id: 'a', file: makeFile('first.png', 1024) },
  { id: 'b', file: makeFile('second.png', 2048) },
];

describe('SortableImageList', () => {
  it('renders image filenames and one-based order labels', () => {
    render(
      <SortableImageList
        files={files}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText('first.png')).toBeInTheDocument();
    expect(screen.getByText('second.png')).toBeInTheDocument();
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('02')).toBeInTheDocument();
  });

  it('removes the selected file by index', () => {
    const onRemove = vi.fn();
    render(
      <SortableImageList
        files={files}
        onReorder={vi.fn()}
        onRemove={onRemove}
      />
    );

    fireEvent.click(screen.getByLabelText('Remove first.png'));

    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
```

- [ ] **Step 2: Run the failing component tests**

Run:

```bash
bun --cwd apps/web test -- src/components/tools/__tests__/sortable-image-list.test.tsx
```

Expected: FAIL because `sortable-image-list.tsx` does not exist.

- [ ] **Step 3: Implement the sortable image list**

Create `apps/web/src/components/tools/sortable-image-list.tsx` with a PDF-free image thumbnail implementation using `@dnd-kit`, `GripVertical`, `ImageIcon`, and `X`. The exported interface must be:

```ts
export interface SortableImageFile {
  id: string;
  file: File;
}

export interface SortableImageListProps {
  files: SortableImageFile[];
  onReorder: (files: SortableImageFile[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}
```

Implementation requirements:

- Render nothing when `files.length === 0`.
- Use object URLs for thumbnails and revoke them in cleanup.
- Call `onRemove(index)` from the remove button.
- Use `arrayMove(files, oldIndex, newIndex)` in `handleDragEnd`.
- Use `aria-label={`Remove ${item.file.name}`}` for removal.

- [ ] **Step 4: Run component tests**

Run:

```bash
bun --cwd apps/web test -- src/components/tools/__tests__/sortable-image-list.test.tsx
```

Expected: PASS.

## Task 3: Tool Metadata and i18n

**Files:**
- Modify: `apps/web/src/lib/tools/tool-metadata.ts`
- Modify: `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Update metadata tests first**

Modify `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`:

```ts
it('does not leave the image catalog under-explained', () => {
  expect(imageToolGroups.flatMap(group => group.tools)).toHaveLength(7);
});

it('registers long image stitching as a free local image composition tool', () => {
  const tool = getToolByHref('/image/stitch');

  expect(tool?.key).toBe('imageStitch');
  expect(tool?.processing).toBe('local');
  expect(tool?.retention).toBe('browser-session');
  expect(tool?.requiresLogin).toBe(false);
});
```

- [ ] **Step 2: Run metadata test and verify failure**

Run:

```bash
bun --cwd apps/web test -- src/components/tools/__tests__/tool-metadata.test.ts
```

Expected: FAIL because `/image/stitch` is not registered.

- [ ] **Step 3: Add catalog metadata**

Modify `apps/web/src/lib/tools/tool-metadata.ts`:

- Import `PanelTop` from `lucide-react`.
- Add an `imageStitch` entry after `imageConvert`:

```ts
{
  key: 'imageStitch',
  href: '/image/stitch',
  icon: PanelTop,
  titleKey: 'ToolCatalog.tools.imageStitch.title',
  descriptionKey: 'ToolCatalog.tools.imageStitch.description',
  categoryKey: 'ToolCatalog.categories.imageCompose',
  processing: 'local',
  retention: 'browser-session',
  requiresLogin: false,
  recommended: true,
  tags: ['stitch', 'long-image', 'ecommerce'],
},
```

- [ ] **Step 4: Add Chinese and English messages**

Modify `apps/web/messages/zh.json`:

- Add `ToolCatalog.categories.imageCompose` and `imageComposeDescription`.
- Add `ToolCatalog.tools.imageStitch`.
- Add an `ImageStitch` namespace with page labels for title, description, dropzone hint, output width, presets, gap, background, output format, quality, filename, start, processing, login CTA, commercial section, brand footer, batch width, and limit messages.

Modify `apps/web/messages/en.json` with matching keys.

- [ ] **Step 5: Run metadata test**

Run:

```bash
bun --cwd apps/web test -- src/components/tools/__tests__/tool-metadata.test.ts
```

Expected: PASS.

## Task 4: Stitch Page

**Files:**
- Create: `apps/web/src/app/[locale]/(app)/image/stitch/page.tsx`

- [ ] **Step 1: Build the client page**

Create `apps/web/src/app/[locale]/(app)/image/stitch/page.tsx` as a client component.

Required behavior:

- Uses `useTranslations('ImageStitch')`, `useTranslations('ToolShell')`, and `authClient.useSession()`.
- Gets tool metadata via `getToolByHref('/image/stitch')!`.
- Uses `FileDropzone` with image accept list and a per-file max size from entitlements.
- Stores files as `SortableImageFile[]` with stable ids.
- Uses `SortableImageList` for order and remove.
- Free config state:
  - width preset `750 | 1080 | 1242 | custom`
  - custom width default `1080`
  - gap default `0`
  - background default `#ffffff`
  - output type default `image/png`
  - quality default `0.92`
  - filename default `stitched-long-image`
- Commercial config state:
  - batch widths text default `750,1080`
  - brand footer text default empty string
- Calls `stitchImages` once for free mode.
- For logged-in users with batch widths, can generate multiple output files and show `ZipDownloadButton`; otherwise show `DownloadButton`.
- Disables generation when fewer than 2 files are uploaded.
- Shows `FailureRecoveryPanel` for errors.
- Shows `ProcessingProgress` while processing.
- Shows `ResultPanel` on success.

- [ ] **Step 2: Run page-related tests**

Run the full existing tool test set:

```bash
bun --cwd apps/web test -- src/components/tools/__tests__/tool-experience.test.tsx src/app/[locale]/(app)/__tests__/tool-detail-adoption.test.ts
```

Expected: PASS or only failures that point to missing `/image/stitch` expectations. Update those tests only if they intentionally assert the complete catalog.

## Task 5: Final Verification

**Files:**
- All files touched by Tasks 1-4.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun --cwd apps/web test -- src/lib/processing/__tests__/image-stitch-client.test.ts src/components/tools/__tests__/sortable-image-list.test.tsx src/components/tools/__tests__/tool-metadata.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the web test suite**

Run:

```bash
bun --cwd apps/web test
```

Expected: PASS.

- [ ] **Step 3: Run lint if available**

Run:

```bash
bun --cwd apps/web lint
```

Expected: PASS, or report if the existing Next lint command is unavailable in this dependency set.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add apps/web/src/lib/processing/image-stitch-client.ts apps/web/src/lib/processing/__tests__/image-stitch-client.test.ts apps/web/src/components/tools/sortable-image-list.tsx apps/web/src/components/tools/__tests__/sortable-image-list.test.tsx apps/web/src/app/[locale]/(app)/image/stitch/page.tsx apps/web/src/lib/tools/tool-metadata.ts apps/web/src/components/tools/__tests__/tool-metadata.test.ts apps/web/messages/zh.json apps/web/messages/en.json docs/superpowers/plans/2026-07-09-image-stitch.md
git commit -m "feat(web): 添加长图拼接工具"
```

Expected: commit succeeds with only the implementation and plan files.

## Self-Review

- Spec coverage: The plan covers local canvas stitching, anonymous free mode, logged-in commercial options, sortable multi-image workflow, catalog integration, i18n, errors, and tests.
- Placeholder scan: The plan contains no `TBD`, `TODO`, or deferred implementation placeholders. It intentionally leaves real payment integration out because the design lists it as a non-goal.
- Type consistency: `ImageStitchOptions`, `ImageStitchOutputType`, `SortableImageFile`, and entitlement names are consistent across tasks.
