# Animated Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an image-module “Animated image” tool at `/image/animation` for GIF creation, basic GIF compression, and logged-in commercial APNG capability.

**Architecture:** Keep the first version front-end local-first. Add focused processing helpers for entitlements, validation, GIF/APNG encoding adapters, and GIF compression, then build a tool page that reuses the existing `ToolPageShell`, `FileDropzone`, progress, failure, and result components. Do not add API task types, DB enum values, OpenAPI generation, or server processors in this plan.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript strict mode, Vitest, Testing Library, `@dnd-kit`, `gifenc`, `omggif`, `upng-js`, `next-intl`.

---

## Scope Check

The spec is one coherent front-end feature: one new image group, one tool route, one local processing module, one frame-list component, i18n, and tests. Server-side high-quality animation processing is explicitly out of scope.

## File Structure

- Create `apps/web/src/lib/processing/image-animation-client.ts`: pure option types, entitlement limits, validation, output naming, image loading, GIF creation, APNG creation, GIF compression.
- Create `apps/web/src/lib/processing/__tests__/image-animation-client.test.ts`: entitlement, naming, validation, and GIF compression option tests.
- Create `apps/web/src/components/tools/animation-frame-list.tsx`: drag-sortable animation frame list with thumbnails and per-frame timing labels.
- Create `apps/web/src/components/tools/__tests__/animation-frame-list.test.tsx`: render, remove, and reorder coverage.
- Create `apps/web/src/app/[locale]/(app)/image/animation/page.tsx`: tool UI with `create`, `compress`, and `convert` modes.
- Modify `apps/web/package.json`: add browser animation libraries and type packages.
- Modify `apps/web/src/lib/tools/tool-metadata.ts`: register `imageAnimation` tool and category group.
- Modify `apps/web/messages/zh.json` and `apps/web/messages/en.json`: add catalog and page copy.
- Modify `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`: include the new tool and group count.
- Modify `apps/web/src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx`: assert the new “Animation” catalog group.
- Modify `apps/web/src/app/[locale]/(app)/__tests__/tool-detail-adoption.test.ts`: assert `/image/animation` adopts shared shell components.

## Library Notes

Use `gifenc` for browser GIF encoding because it supports RGBA quantization and palette application before `GIFEncoder` writes frames. Use `omggif` to decode existing GIF frames for basic compression. Use `upng-js` for APNG output behind the commercial entitlement; its adapter must be isolated so APNG can fail with a clear message without breaking GIF creation.

### Task 1: Dependencies And Metadata

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/lib/tools/tool-metadata.ts`
- Modify: `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`

- [ ] **Step 1: Write the failing metadata test**

Update `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`:

```ts
it('registers animated images as a free local-first commercial-ready tool', () => {
  const tool = getToolByHref('/image/animation');

  expect(tool?.key).toBe('imageAnimation');
  expect(tool?.processing).toBe('local-first');
  expect(tool?.retention).toBe('browser-session');
  expect(tool?.requiresLogin).toBe(false);
  expect(tool?.tags).toEqual(
    expect.arrayContaining(['gif', 'apng', 'animation', 'compress'])
  );
});
```

Also update the existing count assertion:

```ts
expect(imageToolGroups.flatMap(group => group.tools)).toHaveLength(8);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/web
bun test src/components/tools/__tests__/tool-metadata.test.ts
```

Expected: FAIL because `/image/animation` is not registered and the image tool count is still 7.

- [ ] **Step 3: Install browser animation dependencies**

Run:

```bash
cd apps/web
bun add gifenc omggif upng-js
bun add -d @types/omggif @types/upng-js
```

Expected: `apps/web/package.json` and lockfile update with the new packages.

- [ ] **Step 4: Register the tool metadata**

Modify imports in `apps/web/src/lib/tools/tool-metadata.ts`:

```ts
import {
  ArrowUpDown,
  BadgeCheck,
  FileText,
  Film,
  ImageDown,
  Images,
  Info,
  Lock,
  Merge,
  Minimize2,
  PanelTop,
  RefreshCw,
  RotateCw,
  Scissors,
  Stamp,
  Type,
} from 'lucide-react';
```

Insert this `imageTools` entry after `imageConvert`:

```ts
{
  key: 'imageAnimation',
  href: '/image/animation',
  icon: Film,
  titleKey: 'ToolCatalog.tools.imageAnimation.title',
  descriptionKey: 'ToolCatalog.tools.imageAnimation.description',
  categoryKey: 'ToolCatalog.categories.imageAnimation',
  processing: 'local-first',
  retention: 'browser-session',
  requiresLogin: false,
  recommended: true,
  tags: ['gif', 'apng', 'animation', 'compress'],
},
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
cd apps/web
bun test src/components/tools/__tests__/tool-metadata.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json bun.lock apps/web/src/lib/tools/tool-metadata.ts apps/web/src/components/tools/__tests__/tool-metadata.test.ts
git commit -m "feat(web): 注册动画图片工具入口"
```

### Task 2: Processing Types, Entitlements, And Validation

**Files:**
- Create: `apps/web/src/lib/processing/image-animation-client.ts`
- Create: `apps/web/src/lib/processing/__tests__/image-animation-client.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `apps/web/src/lib/processing/__tests__/image-animation-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_ANIMATION_LIMITS,
  getAnimationOutputName,
  getImageAnimationEntitlements,
  normalizeAnimationCreateOptions,
  normalizeAnimationCompressOptions,
  validateAnimationInputs,
  type AnimationCreateOptions,
} from '../image-animation-client';

const baseOptions: AnimationCreateOptions = {
  outputFormat: 'gif',
  width: 640,
  height: 360,
  fit: 'contain',
  background: '#ffffff',
  frameDelayMs: 160,
  repeat: 0,
  quality: 12,
  filename: 'promo-loop',
};

describe('image animation client helpers', () => {
  it('gives logged-in users commercial APNG and advanced compression flags', () => {
    expect(getImageAnimationEntitlements(null)).toMatchObject({
      isLoggedIn: false,
      isCommercial: false,
      canExportGif: true,
      canExportApng: false,
      canUseAdvancedCompression: false,
    });

    expect(getImageAnimationEntitlements({ user: { id: 'u1' } })).toMatchObject({
      isLoggedIn: true,
      isCommercial: true,
      canExportGif: true,
      canExportApng: true,
      canUseAdvancedCompression: true,
    });
  });

  it('builds stable output names for GIF and APNG', () => {
    expect(getAnimationOutputName('promo-loop', 'gif')).toBe('promo-loop.gif');
    expect(getAnimationOutputName('hero.apng', 'gif')).toBe('hero.gif');
    expect(getAnimationOutputName('', 'apng')).toBe('animated-image.apng');
  });

  it('normalizes create options into safe integer bounds', () => {
    expect(
      normalizeAnimationCreateOptions({
        ...baseOptions,
        width: 640.8,
        height: 0,
        frameDelayMs: 7,
        quality: 99,
      })
    ).toMatchObject({
      width: 641,
      height: 1,
      frameDelayMs: 20,
      quality: 30,
    });
  });

  it('normalizes compression options into safe values', () => {
    expect(
      normalizeAnimationCompressOptions({
        targetWidth: 800.4,
        targetFps: 99,
        quality: 0,
        filename: 'compressed',
      })
    ).toMatchObject({
      targetWidth: 800,
      targetFps: 30,
      quality: 1,
      filename: 'compressed',
    });
  });

  it('rejects free users above count and pixel limits', () => {
    const files = Array.from(
      { length: DEFAULT_IMAGE_ANIMATION_LIMITS.free.maxInputFiles + 1 },
      (_, index) => new File(['x'], `f-${index}.png`, { type: 'image/png' })
    );

    expect(() =>
      validateAnimationInputs(files, baseOptions, DEFAULT_IMAGE_ANIMATION_LIMITS.free)
    ).toThrow('Too many frames for the current plan');

    expect(() =>
      validateAnimationInputs(
        [new File(['x'], 'a.png', { type: 'image/png' }), new File(['x'], 'b.png', { type: 'image/png' })],
        { ...baseOptions, width: 10000, height: 10000 },
        DEFAULT_IMAGE_ANIMATION_LIMITS.free
      )
    ).toThrow('Canvas is too large for the current plan');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/web
bun test src/lib/processing/__tests__/image-animation-client.test.ts
```

Expected: FAIL because `image-animation-client.ts` does not exist.

- [ ] **Step 3: Add minimal helper implementation**

Create `apps/web/src/lib/processing/image-animation-client.ts` with:

```ts
export type AnimationOutputFormat = 'gif' | 'apng';
export type AnimationFitMode = 'contain' | 'cover';

export interface AnimationCreateOptions {
  outputFormat: AnimationOutputFormat;
  width: number;
  height: number;
  fit: AnimationFitMode;
  background: string;
  frameDelayMs: number;
  repeat: number;
  quality: number;
  filename: string;
}

export interface AnimationCompressOptions {
  targetWidth: number;
  targetFps: number;
  quality: number;
  filename: string;
}

export interface AnimationPlanLimits {
  maxInputFiles: number;
  maxFileSize: number;
  maxFrames: number;
  maxCanvasPixels: number;
  maxOutputWidth: number;
}

export interface AnimationEntitlements extends AnimationPlanLimits {
  isLoggedIn: boolean;
  isCommercial: boolean;
  canExportGif: boolean;
  canExportApng: boolean;
  canUseAdvancedCompression: boolean;
  canBatchProcess: boolean;
  canSaveHistory: boolean;
}

export const DEFAULT_IMAGE_ANIMATION_LIMITS = {
  free: {
    maxInputFiles: 24,
    maxFileSize: 8 * 1024 * 1024,
    maxFrames: 60,
    maxCanvasPixels: 16_000_000,
    maxOutputWidth: 960,
  },
  commercial: {
    maxInputFiles: 120,
    maxFileSize: 50 * 1024 * 1024,
    maxFrames: 240,
    maxCanvasPixels: 64_000_000,
    maxOutputWidth: 1920,
  },
} satisfies Record<string, AnimationPlanLimits>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getImageAnimationEntitlements(
  session: unknown
): AnimationEntitlements {
  const isLoggedIn = Boolean(session);
  const limits = isLoggedIn
    ? DEFAULT_IMAGE_ANIMATION_LIMITS.commercial
    : DEFAULT_IMAGE_ANIMATION_LIMITS.free;

  return {
    ...limits,
    isLoggedIn,
    isCommercial: isLoggedIn,
    canExportGif: true,
    canExportApng: isLoggedIn,
    canUseAdvancedCompression: isLoggedIn,
    canBatchProcess: isLoggedIn,
    canSaveHistory: isLoggedIn,
  };
}

export function getAnimationOutputName(
  filename: string,
  outputFormat: AnimationOutputFormat
): string {
  const safeBase = filename.trim().replace(/\.[^.]+$/, '');
  const base = safeBase.length > 0 ? safeBase : 'animated-image';
  return `${base}.${outputFormat}`;
}

export function normalizeAnimationCreateOptions(
  options: AnimationCreateOptions
): AnimationCreateOptions {
  return {
    ...options,
    width: Math.max(1, Math.round(options.width)),
    height: Math.max(1, Math.round(options.height)),
    frameDelayMs: clamp(Math.round(options.frameDelayMs), 20, 10_000),
    repeat: Math.max(0, Math.round(options.repeat)),
    quality: clamp(Math.round(options.quality), 1, 30),
  };
}

export function normalizeAnimationCompressOptions(
  options: AnimationCompressOptions
): AnimationCompressOptions {
  return {
    ...options,
    targetWidth: Math.max(1, Math.round(options.targetWidth)),
    targetFps: clamp(Math.round(options.targetFps), 1, 30),
    quality: clamp(Math.round(options.quality), 1, 30),
  };
}

export function validateAnimationInputs(
  files: File[],
  options: AnimationCreateOptions,
  limits: AnimationPlanLimits
): void {
  if (files.length < 2) {
    throw new Error('At least two frames are required');
  }
  if (files.length > limits.maxInputFiles || files.length > limits.maxFrames) {
    throw new Error('Too many frames for the current plan');
  }
  if (files.some(file => file.size > limits.maxFileSize)) {
    throw new Error('File is too large for the current plan');
  }
  const normalized = normalizeAnimationCreateOptions(options);
  if (normalized.width > limits.maxOutputWidth) {
    throw new Error('Output width is too large for the current plan');
  }
  if (normalized.width * normalized.height > limits.maxCanvasPixels) {
    throw new Error('Canvas is too large for the current plan');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd apps/web
bun test src/lib/processing/__tests__/image-animation-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/processing/image-animation-client.ts apps/web/src/lib/processing/__tests__/image-animation-client.test.ts
git commit -m "feat(web): 添加动画图片权益与校验"
```

### Task 3: GIF/APNG Encoding And Basic GIF Compression

**Files:**
- Modify: `apps/web/src/lib/processing/image-animation-client.ts`
- Modify: `apps/web/src/lib/processing/__tests__/image-animation-client.test.ts`

- [ ] **Step 1: Add failing tests for canvas planning and compression sizing**

Append to `image-animation-client.test.ts` imports:

```ts
import {
  buildAnimationFrameLayout,
  resolveCompressedGifPlan,
} from '../image-animation-client';
```

Append tests:

```ts
it('centers contained frames inside the target animation canvas', () => {
  expect(
    buildAnimationFrameLayout(
      { width: 1000, height: 500 },
      { ...baseOptions, width: 500, height: 500, fit: 'contain' }
    )
  ).toEqual({ x: 0, y: 125, width: 500, height: 250 });
});

it('crops cover frames to fill the target animation canvas', () => {
  expect(
    buildAnimationFrameLayout(
      { width: 1000, height: 500 },
      { ...baseOptions, width: 500, height: 500, fit: 'cover' }
    )
  ).toEqual({ x: -250, y: 0, width: 1000, height: 500 });
});

it('keeps compressed GIF dimensions proportional to the requested width', () => {
  expect(
    resolveCompressedGifPlan(
      { width: 800, height: 400, frameCount: 20 },
      { targetWidth: 400, targetFps: 12, quality: 10, filename: 'small' },
      DEFAULT_IMAGE_ANIMATION_LIMITS.free
    )
  ).toMatchObject({ width: 400, height: 200, targetFps: 12 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/web
bun test src/lib/processing/__tests__/image-animation-client.test.ts
```

Expected: FAIL because layout and compression plan helpers are not exported.

- [ ] **Step 3: Add frame layout and GIF/APNG implementation**

Add these imports at the top of `image-animation-client.ts`, before the first export:

```ts
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { GifReader } from 'omggif';
import UPNG from 'upng-js';
```

Then extend `image-animation-client.ts` with the following exported types and functions:

```ts

export interface AnimationSourceSize {
  width: number;
  height: number;
}

export interface AnimationFrameLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GifInfo {
  width: number;
  height: number;
  frameCount: number;
}

export interface CompressedGifPlan {
  width: number;
  height: number;
  targetFps: number;
  frameStep: number;
}

export function buildAnimationFrameLayout(
  source: AnimationSourceSize,
  options: AnimationCreateOptions
): AnimationFrameLayout {
  const normalized = normalizeAnimationCreateOptions(options);
  const scale =
    normalized.fit === 'cover'
      ? Math.max(normalized.width / source.width, normalized.height / source.height)
      : Math.min(normalized.width / source.width, normalized.height / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  return {
    x: Math.round((normalized.width - width) / 2),
    y: Math.round((normalized.height - height) / 2),
    width,
    height,
  };
}

export function resolveCompressedGifPlan(
  info: GifInfo,
  options: AnimationCompressOptions,
  limits: AnimationPlanLimits
): CompressedGifPlan {
  const normalized = normalizeAnimationCompressOptions(options);
  const width = Math.min(normalized.targetWidth, limits.maxOutputWidth, info.width);
  const height = Math.max(1, Math.round(info.height * (width / info.width)));
  if (width * height > limits.maxCanvasPixels) {
    throw new Error('Canvas is too large for the current plan');
  }
  return {
    width,
    height,
    targetFps: normalized.targetFps,
    frameStep: Math.max(1, Math.ceil(info.frameCount / limits.maxFrames)),
  };
}

async function loadAnimationImage(file: File): Promise<HTMLImageElement> {
  const image = new Image();
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image frame'));
    };
    image.src = url;
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function readCanvasRgba(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function encodeGifFrames(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
  options: Pick<AnimationCreateOptions, 'frameDelayMs' | 'repeat' | 'quality'>
): Uint8Array {
  const gif = GIFEncoder();
  frames.forEach(frame => {
    const palette = quantize(frame, 256, { format: 'rgba4444' });
    const index = applyPalette(frame, palette, 'rgba4444');
    gif.writeFrame(index, width, height, {
      palette,
      delay: options.frameDelayMs,
      repeat: options.repeat,
      transparent: false,
    });
  });
  gif.finish();
  return gif.bytes();
}

function encodeApngFrames(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
  delayMs: number
): Uint8Array {
  const buffers = frames.map(frame => frame.buffer.slice(0));
  const delays = frames.map(() => delayMs);
  return new Uint8Array(UPNG.encode(buffers, width, height, 0, delays));
}

export async function createAnimationFromImages(
  files: File[],
  options: AnimationCreateOptions,
  limits: AnimationPlanLimits
): Promise<File> {
  validateAnimationInputs(files, options, limits);
  const normalized = normalizeAnimationCreateOptions(options);
  const images = await Promise.all(files.map(loadAnimationImage));
  const frames = images.map(image => {
    const canvas = createCanvas(normalized.width, normalized.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    if (normalized.background !== 'transparent') {
      ctx.fillStyle = normalized.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const layout = buildAnimationFrameLayout(
      { width: image.naturalWidth, height: image.naturalHeight },
      normalized
    );
    ctx.drawImage(image, layout.x, layout.y, layout.width, layout.height);
    return readCanvasRgba(canvas);
  });

  const bytes =
    normalized.outputFormat === 'apng'
      ? encodeApngFrames(frames, normalized.width, normalized.height, normalized.frameDelayMs)
      : encodeGifFrames(frames, normalized.width, normalized.height, normalized);
  const mimeType = normalized.outputFormat === 'apng' ? 'image/apng' : 'image/gif';
  return new File(
    [bytes],
    getAnimationOutputName(normalized.filename, normalized.outputFormat),
    { type: mimeType }
  );
}

export async function compressGif(
  file: File,
  options: AnimationCompressOptions,
  limits: AnimationPlanLimits
): Promise<File> {
  if (file.size > limits.maxFileSize) {
    throw new Error('File is too large for the current plan');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const reader = new GifReader(bytes);
  const plan = resolveCompressedGifPlan(
    { width: reader.width, height: reader.height, frameCount: reader.numFrames() },
    options,
    limits
  );
  const canvas = createCanvas(plan.width, plan.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  const frames: Uint8ClampedArray[] = [];
  for (let index = 0; index < reader.numFrames(); index += plan.frameStep) {
    const rgba = new Uint8ClampedArray(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(index, rgba);
    const source = new ImageData(rgba, reader.width, reader.height);
    const sourceCanvas = createCanvas(reader.width, reader.height);
    const sourceCtx = sourceCanvas.getContext('2d');
    if (!sourceCtx) throw new Error('Canvas is not available');
    sourceCtx.putImageData(source, 0, 0);
    ctx.clearRect(0, 0, plan.width, plan.height);
    ctx.drawImage(sourceCanvas, 0, 0, plan.width, plan.height);
    frames.push(readCanvasRgba(canvas));
  }
  const normalized = normalizeAnimationCompressOptions(options);
  const delay = Math.round(1000 / plan.targetFps);
  const encoded = encodeGifFrames(frames, plan.width, plan.height, {
    frameDelayMs: delay,
    repeat: 0,
    quality: normalized.quality,
  });
  return new File([encoded], getAnimationOutputName(normalized.filename, 'gif'), {
    type: 'image/gif',
  });
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
cd apps/web
bun test src/lib/processing/__tests__/image-animation-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck/build smoke**

Run:

```bash
cd apps/web
bun run build
```

Expected: PASS. If `upng-js` default import fails, replace `import UPNG from 'upng-js';` with `import * as UPNG from 'upng-js';` and rerun.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/processing/image-animation-client.ts apps/web/src/lib/processing/__tests__/image-animation-client.test.ts
git commit -m "feat(web): 添加本地动画图片处理"
```

### Task 4: Animation Frame List Component

**Files:**
- Create: `apps/web/src/components/tools/animation-frame-list.tsx`
- Create: `apps/web/src/components/tools/__tests__/animation-frame-list.test.tsx`

- [ ] **Step 1: Write failing component test**

Create `apps/web/src/components/tools/__tests__/animation-frame-list.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import {
  AnimationFrameList,
  type AnimationFrameFile,
} from '../animation-frame-list';

const frames: AnimationFrameFile[] = [
  {
    id: 'a',
    file: new File(['a'], 'first.png', { type: 'image/png' }),
    delayMs: 160,
  },
  {
    id: 'b',
    file: new File(['b'], 'second.png', { type: 'image/png' }),
    delayMs: 200,
  },
];

function renderList(onRemove = vi.fn()) {
  const onReorder = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AnimationFrameList
        frames={frames}
        onReorder={onReorder}
        onRemove={onRemove}
        disabled={false}
      />
    </NextIntlClientProvider>
  );
  return { onReorder, onRemove };
}

describe('AnimationFrameList', () => {
  it('renders frame names, sequence numbers, and frame delays', () => {
    renderList();

    expect(screen.getByText('first.png')).toBeInTheDocument();
    expect(screen.getByText('second.png')).toBeInTheDocument();
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('160 ms')).toBeInTheDocument();
  });

  it('removes a frame by index', () => {
    const onRemove = vi.fn();
    renderList(onRemove);

    fireEvent.click(screen.getByLabelText('Remove first.png'));

    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/web
bun test src/components/tools/__tests__/animation-frame-list.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Create component**

Create `apps/web/src/components/tools/animation-frame-list.tsx` by adapting `sortable-image-list.tsx` and using this public interface:

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ImageIcon, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface AnimationFrameFile {
  id: string;
  file: File;
  delayMs: number;
}

export interface AnimationFrameListProps {
  frames: AnimationFrameFile[];
  onReorder: (frames: AnimationFrameFile[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}
```

Use the same DnD setup as `SortableImageList`. In each row render file name, formatted file size, sequence number, and:

```tsx
<span className="font-mono text-[10px] tabular-nums text-muted-foreground">
  {item.delayMs} ms
</span>
```

Return `null` when `frames.length === 0`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd apps/web
bun test src/components/tools/__tests__/animation-frame-list.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/tools/animation-frame-list.tsx apps/web/src/components/tools/__tests__/animation-frame-list.test.tsx
git commit -m "feat(web): 添加动画帧排序列表"
```

### Task 5: I18n Catalog And Page Copy

**Files:**
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx`

- [ ] **Step 1: Write failing catalog page assertions**

In `catalog-pages.test.tsx`, add image catalog expectations:

```ts
expect(
  screen.getByRole('heading', { name: 'Animation' })
).toBeInTheDocument();
expect(screen.getByRole('link', { name: /GIF \/ APNG maker/ })).toHaveAttribute(
  'href',
  expect.stringContaining('/image/animation')
);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/web
bun test 'src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx'
```

Expected: FAIL because catalog copy is missing.

- [ ] **Step 3: Add Chinese messages**

Add under `ToolCatalog.categories` in `apps/web/messages/zh.json`:

```json
"imageAnimation": "动画图片",
"imageAnimationDescription": "制作、压缩和准备 GIF/APNG 动图素材。"
```

Add under `ToolCatalog.tools`:

```json
"imageAnimation": {
  "title": "GIF/APNG 制作与压缩",
  "description": "用图片序列制作 GIF，并为登录商业版预留 APNG 和高级压缩。"
}
```

Add top-level `ImageAnimation`:

```json
"ImageAnimation": {
  "title": "GIF/APNG 制作与压缩",
  "description": "制作轻量动图、压缩已有 GIF，并为登录商业版开放 APNG 和高级参数。",
  "dropzoneCreateHint": "上传 PNG、JPG 或 WebP 图片作为动画帧。",
  "dropzoneCompressHint": "上传一个 GIF 文件进行基础压缩。",
  "processingLabel": "正在处理动画图片…",
  "modes": {
    "create": "制作",
    "compress": "压缩",
    "convert": "转换"
  },
  "outputFormat": "输出格式",
  "canvasSize": "画布尺寸",
  "width": "宽度",
  "height": "高度",
  "fit": "适配方式",
  "contain": "完整显示",
  "cover": "填满裁切",
  "background": "背景色",
  "frameDelay": "帧间隔",
  "loop": "循环",
  "quality": "质量",
  "filename": "文件名",
  "filenamePlaceholder": "animated-image",
  "targetWidth": "目标宽度",
  "targetFps": "目标帧率",
  "commercialTitle": "商业版动画能力",
  "commercialDescription": "登录后开放 APNG、更多帧数、更大尺寸和高级压缩参数。未来接入付费时复用同一套权益判断。",
  "loginTitle": "登录解锁商业版动画能力",
  "loginDescription": "免费版可制作 GIF；登录后可使用 APNG、高级压缩和更高处理限制。",
  "loginAction": "登录使用商业版",
  "convertTitle": "转换能力将复用动画处理链路",
  "convertDescription": "首版优先完成制作和压缩；GIF/APNG/WebP 动图互转会在后续扩展。",
  "start": "生成动画",
  "startWithCount": "生成 {count} 帧动画",
  "compressAction": "压缩 GIF",
  "processing": "处理中…",
  "resultTitle": "动画已生成",
  "compressedResultTitle": "GIF 已压缩",
  "resultDescription": "{name}，{size}",
  "compressionResultDescription": "从 {before} 压缩到 {after}",
  "limits": {
    "needAtLeastTwo": "至少需要 2 张图片才能制作动画。",
    "gifOnly": "压缩模式首版仅支持 GIF 文件。",
    "apngLogin": "APNG 是登录商业版能力。",
    "invalidSize": "请输入有效的画布尺寸。",
    "processingFailed": "动画处理失败，请减少帧数或降低尺寸后重试。"
  }
}
```

- [ ] **Step 4: Add English messages**

Add under `ToolCatalog.categories` in `apps/web/messages/en.json`:

```json
"imageAnimation": "Animation",
"imageAnimationDescription": "Create, compress, and prepare GIF/APNG animation assets."
```

Add under `ToolCatalog.tools`:

```json
"imageAnimation": {
  "title": "GIF / APNG maker",
  "description": "Create GIFs from image sequences, with APNG and advanced compression for signed-in commercial users."
}
```

Add top-level `ImageAnimation`:

```json
"ImageAnimation": {
  "title": "GIF / APNG maker",
  "description": "Create lightweight animations, compress existing GIFs, and unlock APNG plus advanced controls when signed in.",
  "dropzoneCreateHint": "Upload PNG, JPG, or WebP images as animation frames.",
  "dropzoneCompressHint": "Upload one GIF file for basic compression.",
  "processingLabel": "Processing animated image…",
  "modes": {
    "create": "Create",
    "compress": "Compress",
    "convert": "Convert"
  },
  "outputFormat": "Output format",
  "canvasSize": "Canvas size",
  "width": "Width",
  "height": "Height",
  "fit": "Fit",
  "contain": "Contain",
  "cover": "Cover",
  "background": "Background",
  "frameDelay": "Frame delay",
  "loop": "Loop",
  "quality": "Quality",
  "filename": "Filename",
  "filenamePlaceholder": "animated-image",
  "targetWidth": "Target width",
  "targetFps": "Target FPS",
  "commercialTitle": "Commercial animation tools",
  "commercialDescription": "Signed-in users get APNG, more frames, larger output, and advanced compression controls. Future paid plans reuse this entitlement layer.",
  "loginTitle": "Sign in for commercial animation tools",
  "loginDescription": "Free users can create GIFs. Signed-in users unlock APNG, advanced compression, and higher limits.",
  "loginAction": "Sign in for commercial",
  "convertTitle": "Conversion will reuse the animation pipeline",
  "convertDescription": "The first version prioritizes creation and compression. GIF/APNG/WebP animation conversion can expand here later.",
  "start": "Generate animation",
  "startWithCount": "Generate {count}-frame animation",
  "compressAction": "Compress GIF",
  "processing": "Processing…",
  "resultTitle": "Animation ready",
  "compressedResultTitle": "GIF compressed",
  "resultDescription": "{name}, {size}",
  "compressionResultDescription": "Compressed from {before} to {after}",
  "limits": {
    "needAtLeastTwo": "At least two images are required to create an animation.",
    "gifOnly": "The first compression version supports GIF files only.",
    "apngLogin": "APNG is available to signed-in commercial users.",
    "invalidSize": "Enter a valid canvas size.",
    "processingFailed": "Animation processing failed. Try fewer frames or a smaller size."
  }
}
```

- [ ] **Step 5: Run catalog page test**

Run:

```bash
cd apps/web
bun test 'src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx'
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/messages/zh.json apps/web/messages/en.json 'apps/web/src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx'
git commit -m "feat(web): 添加动画图片工具文案"
```

### Task 6: Animation Tool Page

**Files:**
- Create: `apps/web/src/app/[locale]/(app)/image/animation/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/__tests__/tool-detail-adoption.test.ts`

- [ ] **Step 1: Write failing adoption test**

Add to `detailPages` in `tool-detail-adoption.test.ts`:

```ts
['/image/animation', 'src/app/[locale]/(app)/image/animation/page.tsx'],
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/web
bun test 'src/app/[locale]/(app)/__tests__/tool-detail-adoption.test.ts'
```

Expected: FAIL because the animation page does not exist.

- [ ] **Step 3: Create page shell and state**

Create `apps/web/src/app/[locale]/(app)/image/animation/page.tsx` with:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { FileDropzone } from '@/components/tools/file-dropzone';
import {
  AnimationFrameList,
  type AnimationFrameFile,
} from '@/components/tools/animation-frame-list';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import {
  compressGif,
  createAnimationFromImages,
  getImageAnimationEntitlements,
  type AnimationFitMode,
  type AnimationOutputFormat,
} from '@/lib/processing/image-animation-client';
import { formatBytes } from '@/lib/format';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { cn } from '@/lib/utils';

type AnimationMode = 'create' | 'compress' | 'convert';

interface CreateOptionsState {
  outputFormat: AnimationOutputFormat;
  width: number;
  height: number;
  fit: AnimationFitMode;
  background: string;
  frameDelayMs: number;
  repeat: number;
  quality: number;
  filename: string;
}

interface CompressOptionsState {
  targetWidth: number;
  targetFps: number;
  quality: number;
  filename: string;
}
```

Initialize state:

```tsx
const [mode, setMode] = useState<AnimationMode>('create');
const [frames, setFrames] = useState<AnimationFrameFile[]>([]);
const [gifFile, setGifFile] = useState<File | null>(null);
const [createOptions, setCreateOptions] = useState<CreateOptionsState>({
  outputFormat: 'gif',
  width: 640,
  height: 360,
  fit: 'contain',
  background: '#ffffff',
  frameDelayMs: 160,
  repeat: 0,
  quality: 12,
  filename: 'animated-image',
});
const [compressOptions, setCompressOptions] = useState<CompressOptionsState>({
  targetWidth: 640,
  targetFps: 12,
  quality: 12,
  filename: 'compressed-gif',
});
const [processing, setProcessing] = useState(false);
const [progress, setProgress] = useState(0);
const [result, setResult] = useState<File | null>(null);
const [originalSize, setOriginalSize] = useState<number | null>(null);
const [error, setError] = useState<string | null>(null);
```

- [ ] **Step 4: Add create/compress handlers**

Use these handlers in the page:

```tsx
function makeFrameId(file: File): string {
  return `${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`;
}

const handleCreateDrop = (dropped: File[]) => {
  const availableSlots = entitlements.maxInputFiles - frames.length;
  const accepted = dropped
    .filter(file => file.size <= entitlements.maxFileSize)
    .slice(0, availableSlots);
  setFrames(prev => [
    ...prev,
    ...accepted.map(file => ({
      id: makeFrameId(file),
      file,
      delayMs: createOptions.frameDelayMs,
    })),
  ]);
  setResult(null);
  setError(accepted.length < dropped.length ? t('limits.processingFailed') : null);
};

const handleCompressDrop = (dropped: File[]) => {
  const file = dropped[0];
  if (!file) return;
  if (file.type !== 'image/gif' && !file.name.toLowerCase().endsWith('.gif')) {
    setError(t('limits.gifOnly'));
    return;
  }
  setGifFile(file);
  setOriginalSize(file.size);
  setResult(null);
  setError(null);
};

const handleGenerate = async () => {
  if (mode === 'create' && frames.length < 2) {
    setError(t('limits.needAtLeastTwo'));
    return;
  }
  if (createOptions.outputFormat === 'apng' && !entitlements.canExportApng) {
    setError(t('limits.apngLogin'));
    return;
  }
  setProcessing(true);
  setProgress(10);
  setError(null);
  try {
    const output = await createAnimationFromImages(
      frames.map(frame => frame.file),
      createOptions,
      entitlements
    );
    setProgress(100);
    setResult(output);
  } catch (err) {
    setError((err as Error).message || t('limits.processingFailed'));
  } finally {
    setProcessing(false);
  }
};

const handleCompress = async () => {
  if (!gifFile) {
    setError(t('limits.gifOnly'));
    return;
  }
  setProcessing(true);
  setProgress(10);
  setError(null);
  try {
    const output = await compressGif(gifFile, compressOptions, entitlements);
    setProgress(100);
    setResult(output);
  } catch (err) {
    setError((err as Error).message || t('limits.processingFailed'));
  } finally {
    setProcessing(false);
  }
};
```

- [ ] **Step 5: Render modes and controls**

Render with `ToolPageShell` and ensure the source contains:

```tsx
const t = useTranslations('ImageAnimation');
const tShell = useTranslations('ToolShell');
const locale = useLocale();
const router = useRouter();
const tool = getToolByHref('/image/animation')!;
const { data: session } = authClient.useSession();
const entitlements = getImageAnimationEntitlements(session);
const hasResult = Boolean(result);
const stage = hasResult
  ? 'result'
  : processing
    ? 'processing'
    : (mode === 'create' && frames.length > 0) || (mode === 'compress' && gifFile)
      ? 'configure'
      : 'upload';
```

Use segmented mode buttons:

```tsx
{(['create', 'compress', 'convert'] as const).map(nextMode => (
  <button
    key={nextMode}
    type="button"
    onClick={() => {
      setMode(nextMode);
      setResult(null);
      setError(null);
    }}
    className={cn(
      'h-8 rounded-sm px-3 font-mono text-xs transition-colors',
      mode === nextMode
        ? 'bg-foreground text-background'
        : 'text-muted-foreground hover:text-foreground'
    )}
  >
    {t(`modes.${nextMode}`)}
  </button>
))}
```

For create mode, render `FileDropzone`, `AnimationFrameList`, numeric inputs for width, height, frame delay, repeat, quality, filename, fit buttons, GIF/APNG format buttons, and a full-width generate button. Disable APNG when `!entitlements.canExportApng`.

For compress mode, render `FileDropzone`, current GIF name/size, target width, target FPS, quality, filename, and a full-width compress button.

For convert mode, render `t('convertTitle')` and `t('convertDescription')` only.

Render login/commercial panel:

```tsx
{session ? (
  <section className="space-y-1 rounded-md border border-border p-4">
    <h2 className="text-sm font-medium">{t('commercialTitle')}</h2>
    <p className="text-xs text-muted-foreground">{t('commercialDescription')}</p>
  </section>
) : (
  <section className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h2 className="text-sm font-medium">{t('loginTitle')}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t('loginDescription')}</p>
    </div>
    <button
      type="button"
      onClick={() => router.push(`/login?next=${encodeURIComponent('/image/animation')}`)}
      className="h-9 shrink-0 rounded-md border border-border px-3 font-mono text-xs text-foreground transition-colors hover:bg-muted/40"
    >
      {t('loginAction')}
    </button>
  </section>
)}
```

Render progress, error, and result:

```tsx
{processing && <ProcessingProgress progress={progress} stage="processing" />}
{error && (
  <FailureRecoveryPanel
    message={error}
    onRetry={mode === 'compress' ? handleCompress : handleGenerate}
    onReset={() => {
      setFrames([]);
      setGifFile(null);
      setResult(null);
      setError(null);
      setProgress(0);
    }}
  />
)}
{result && (
  <ResultPanel
    title={mode === 'compress' ? t('compressedResultTitle') : t('resultTitle')}
    description={
      mode === 'compress' && originalSize
        ? t('compressionResultDescription', {
            before: formatBytes(originalSize, useTranslations('Common.units'), locale),
            after: formatBytes(result.size, useTranslations('Common.units'), locale),
          })
        : t('resultDescription', {
            name: result.name,
            size: formatBytes(result.size, useTranslations('Common.units'), locale),
          })
    }
    action={<DownloadButton file={result} />}
  />
)}
```

If calling `useTranslations('Common.units')` inside JSX causes a hooks lint error, move it to the top level:

```tsx
const tUnits = useTranslations('Common.units');
```

and use `formatBytes(value, tUnits, locale)`.

- [ ] **Step 6: Run adoption test**

Run:

```bash
cd apps/web
bun test 'src/app/[locale]/(app)/__tests__/tool-detail-adoption.test.ts'
```

Expected: PASS.

- [ ] **Step 7: Run page build smoke**

Run:

```bash
cd apps/web
bun run build
```

Expected: PASS. If the page grows too large or lint complains about hooks in branches, extract `ModeButton`, `NumberField`, and `FormatButtons` into local functions above the component.

- [ ] **Step 8: Commit**

```bash
git add 'apps/web/src/app/[locale]/(app)/image/animation/page.tsx' 'apps/web/src/app/[locale]/(app)/__tests__/tool-detail-adoption.test.ts'
git commit -m "feat(web): 添加动画图片工具页面"
```

### Task 7: Final Verification And Polish

**Files:**
- Potentially modify files from Tasks 1-6 only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
cd apps/web
bun test src/lib/processing/__tests__/image-animation-client.test.ts src/components/tools/__tests__/animation-frame-list.test.tsx src/components/tools/__tests__/tool-metadata.test.ts 'src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx' 'src/app/[locale]/(app)/__tests__/tool-detail-adoption.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run broader web tests**

Run:

```bash
cd apps/web
bun test
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
cd apps/web
bun run build
```

Expected: PASS.

- [ ] **Step 4: Manual local smoke**

Run:

```bash
cd apps/web
bun run dev
```

Open `http://localhost:3000/zh/image/animation` and check:

- The trust strip says local-first and no sign-in required.
- Create mode accepts at least two images and generates a GIF.
- Anonymous APNG button is disabled or shows the login/commercial message.
- Compress mode rejects non-GIF files.
- Convert mode displays the scoped future-facing message.
- Login panel text matches the commercial layer agreed in the spec.

Stop the dev server after smoke testing.

- [ ] **Step 5: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended files changed, no `.env.local`, no API, no DB migration.

- [ ] **Step 6: Commit verification fixes if any**

If verification required fixes:

```bash
git add apps/web/package.json bun.lock apps/web/src apps/web/messages
git commit -m "fix(web): 完善动画图片工具验证"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: the plan includes the `/image/animation` route, image catalog grouping, anonymous free GIF creation, logged-in commercial APNG/high-limit UI, basic GIF compression, local-first processing, i18n, tests, and explicit non-use of server tasks.
- Red-flag scan: no implementation step depends on unresolved placeholder language. APNG uncertainty is handled by an adapter and build verification step.
- Type consistency: `AnimationOutputFormat`, `AnimationCreateOptions`, `AnimationCompressOptions`, `AnimationEntitlements`, `createAnimationFromImages`, and `compressGif` are defined before they are used by page tasks.
- Scope check: server-side `image_animation_*` tasks, DB enum changes, OpenAPI export, real payment, and video-to-GIF remain out of this implementation plan.
