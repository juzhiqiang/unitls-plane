# Entitlements System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared entitlement layer so current signed-in commercial previews and future paid plans use one source of truth across Web and API.

**Architecture:** Add plan resolution, feature gates, and numeric limits to `@utils-plane/utils`, then consume it from API upload/task creation and Web tool metadata/client-side entitlement helpers. This first pass keeps the existing database schema (`user.plan`, `user.role`) and does not add payment, teams, or license enforcement.

**Tech Stack:** TypeScript, Bun tests, NestJS services/controllers, Next.js tool metadata, existing `@utils-plane/utils` workspace package.

---

## File Structure

- Create `packages/utils/src/entitlements.ts`: shared plan, feature, and limit definitions.
- Create `packages/utils/src/entitlements.test.ts`: unit tests for plan resolution, feature gates, and limits.
- Modify `packages/utils/src/index.ts`: export entitlement APIs.
- Modify `apps/api/package.json`: add `@utils-plane/utils` dependency.
- Modify `apps/web/package.json`: add `@utils-plane/utils` dependency.
- Modify `apps/api/src/modules/files/files.controller.ts`: pass the full current user to `FilesService.upload`.
- Modify `apps/api/src/modules/files/files.service.ts`: replace hardcoded upload limits with shared entitlement limits.
- Modify `apps/api/src/modules/files/files.controller.test.ts`: add source-boundary checks for shared entitlement usage.
- Modify `apps/api/src/modules/tasks/tasks.controller.ts`: pass the full current user to `TasksService.create`.
- Modify `apps/api/src/modules/tasks/tasks.service.ts`: enforce login-required server task access through shared feature gates.
- Modify `apps/api/src/modules/tasks/tasks.service.test.ts`: add task entitlement tests.
- Modify `apps/web/src/lib/tools/tool-metadata.ts`: add `featureKey` and `limitKeys` metadata while preserving existing UI behavior.
- Modify `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`: verify commercial-ready tool feature keys.
- Modify `apps/web/src/lib/processing/image-animation-client.ts`: derive limits and flags from shared entitlements.
- Modify `apps/web/src/lib/processing/image-stitch-client.ts`: derive limits and flags from shared entitlements.
- Modify existing processing tests for animation and stitch only where expectations need to reference shared values.

---

### Task 1: Shared Entitlement Module

**Files:**

- Create: `packages/utils/src/entitlements.ts`
- Create: `packages/utils/src/entitlements.test.ts`
- Modify: `packages/utils/src/index.ts`

- [ ] **Step 1: Write entitlement tests**

Create `packages/utils/src/entitlements.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
  canUseFeature,
  getLimit,
  resolveEntitlementPlan,
} from './entitlements';

describe('entitlements', () => {
  it('treats anonymous users as free and signed-in free users as signed_in', () => {
    expect(resolveEntitlementPlan()).toBe('free');
    expect(resolveEntitlementPlan({ userId: 'user-1', plan: 'free' })).toBe(
      'signed_in'
    );
  });

  it('preserves explicit commercial plans and admin override', () => {
    expect(resolveEntitlementPlan({ userId: 'user-1', plan: 'pro' })).toBe(
      'pro'
    );
    expect(resolveEntitlementPlan({ userId: 'user-1', role: 'admin' })).toBe(
      'pro'
    );
  });

  it('gates commercial features behind signed-in or stronger plans', () => {
    expect(canUseFeature(undefined, 'image.animation.gif')).toBe(true);
    expect(canUseFeature(undefined, 'image.animation.apng')).toBe(false);
    expect(
      canUseFeature({ userId: 'user-1', plan: 'free' }, 'image.animation.apng')
    ).toBe(true);
    expect(canUseFeature(undefined, 'pdf.document.serverExport')).toBe(false);
    expect(
      canUseFeature(
        { userId: 'user-1', plan: 'free' },
        'pdf.document.serverExport'
      )
    ).toBe(true);
  });

  it('returns current upload and image limits for free and signed-in users', () => {
    expect(getLimit(undefined, 'upload.maxFileSize')).toBe(10 * 1024 * 1024);
    expect(getLimit({ userId: 'user-1' }, 'upload.maxFileSize')).toBe(
      50 * 1024 * 1024
    );
    expect(getLimit(undefined, 'image.animation.maxFrames')).toBe(60);
    expect(getLimit({ userId: 'user-1' }, 'image.animation.maxFrames')).toBe(
      240
    );
    expect(getLimit(undefined, 'image.stitch.maxFiles')).toBe(12);
    expect(getLimit({ userId: 'user-1' }, 'image.stitch.maxFiles')).toBe(40);
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
bun test packages/utils/src/entitlements.test.ts
```

Expected: FAIL because `packages/utils/src/entitlements.ts` does not exist.

- [ ] **Step 3: Add the entitlement module**

Create `packages/utils/src/entitlements.ts`:

```ts
export type EntitlementPlan =
  | 'free'
  | 'signed_in'
  | 'pro_preview'
  | 'pro'
  | 'team'
  | 'private';

export type EntitlementUser = {
  userId?: string | null;
  plan?: string | null;
  role?: string | null;
};

export type FeatureKey =
  | 'upload.file'
  | 'task.serverProcessing'
  | 'image.animation.gif'
  | 'image.animation.apng'
  | 'image.animation.advancedCompression'
  | 'image.animation.batch'
  | 'image.stitch.basic'
  | 'image.stitch.batch'
  | 'image.stitch.brandFooter'
  | 'image.idPhoto.generate'
  | 'pdf.document.localExport'
  | 'pdf.document.serverExport';

export type LimitKey =
  | 'upload.maxFileSize'
  | 'image.animation.maxInputFiles'
  | 'image.animation.maxFileSize'
  | 'image.animation.maxFrames'
  | 'image.animation.maxCanvasPixels'
  | 'image.animation.maxTotalFramePixels'
  | 'image.animation.maxOutputWidth'
  | 'image.stitch.maxFiles'
  | 'image.stitch.maxFileSize'
  | 'image.stitch.maxCanvasPixels';

const PLAN_RANK: Record<EntitlementPlan, number> = {
  free: 0,
  signed_in: 1,
  pro_preview: 2,
  pro: 3,
  team: 4,
  private: 5,
};

const FEATURE_MIN_PLAN: Record<FeatureKey, EntitlementPlan> = {
  'upload.file': 'free',
  'task.serverProcessing': 'signed_in',
  'image.animation.gif': 'free',
  'image.animation.apng': 'signed_in',
  'image.animation.advancedCompression': 'signed_in',
  'image.animation.batch': 'signed_in',
  'image.stitch.basic': 'free',
  'image.stitch.batch': 'signed_in',
  'image.stitch.brandFooter': 'signed_in',
  'image.idPhoto.generate': 'signed_in',
  'pdf.document.localExport': 'free',
  'pdf.document.serverExport': 'signed_in',
};

const LIMITS: Record<LimitKey, Record<EntitlementPlan, number>> = {
  'upload.maxFileSize': {
    free: 10 * 1024 * 1024,
    signed_in: 50 * 1024 * 1024,
    pro_preview: 50 * 1024 * 1024,
    pro: 100 * 1024 * 1024,
    team: 150 * 1024 * 1024,
    private: 250 * 1024 * 1024,
  },
  'image.animation.maxInputFiles': {
    free: 24,
    signed_in: 120,
    pro_preview: 120,
    pro: 180,
    team: 240,
    private: 300,
  },
  'image.animation.maxFileSize': {
    free: 8 * 1024 * 1024,
    signed_in: 50 * 1024 * 1024,
    pro_preview: 50 * 1024 * 1024,
    pro: 80 * 1024 * 1024,
    team: 100 * 1024 * 1024,
    private: 150 * 1024 * 1024,
  },
  'image.animation.maxFrames': {
    free: 60,
    signed_in: 240,
    pro_preview: 240,
    pro: 360,
    team: 480,
    private: 600,
  },
  'image.animation.maxCanvasPixels': {
    free: 16_000_000,
    signed_in: 64_000_000,
    pro_preview: 64_000_000,
    pro: 96_000_000,
    team: 128_000_000,
    private: 160_000_000,
  },
  'image.animation.maxTotalFramePixels': {
    free: 48_000_000,
    signed_in: 160_000_000,
    pro_preview: 160_000_000,
    pro: 240_000_000,
    team: 320_000_000,
    private: 400_000_000,
  },
  'image.animation.maxOutputWidth': {
    free: 960,
    signed_in: 1920,
    pro_preview: 1920,
    pro: 2560,
    team: 3200,
    private: 4096,
  },
  'image.stitch.maxFiles': {
    free: 12,
    signed_in: 40,
    pro_preview: 40,
    pro: 80,
    team: 120,
    private: 200,
  },
  'image.stitch.maxFileSize': {
    free: 10 * 1024 * 1024,
    signed_in: 50 * 1024 * 1024,
    pro_preview: 50 * 1024 * 1024,
    pro: 80 * 1024 * 1024,
    team: 100 * 1024 * 1024,
    private: 150 * 1024 * 1024,
  },
  'image.stitch.maxCanvasPixels': {
    free: 32_000_000,
    signed_in: 96_000_000,
    pro_preview: 96_000_000,
    pro: 140_000_000,
    team: 180_000_000,
    private: 240_000_000,
  },
};

function isKnownPlan(plan: string | null | undefined): plan is EntitlementPlan {
  return Boolean(plan && plan in PLAN_RANK);
}

export function resolveEntitlementPlan(
  user?: EntitlementUser | null
): EntitlementPlan {
  if (!user?.userId) {
    return 'free';
  }

  if (user.role === 'admin') {
    return 'pro';
  }

  if (isKnownPlan(user.plan) && user.plan !== 'free') {
    return user.plan;
  }

  return 'signed_in';
}

export function isPlanAtLeast(
  actual: EntitlementPlan,
  required: EntitlementPlan
): boolean {
  return PLAN_RANK[actual] >= PLAN_RANK[required];
}

export function canUseFeature(
  user: EntitlementUser | null | undefined,
  feature: FeatureKey
): boolean {
  return isPlanAtLeast(resolveEntitlementPlan(user), FEATURE_MIN_PLAN[feature]);
}

export function getLimit(
  user: EntitlementUser | null | undefined,
  limit: LimitKey
): number {
  return LIMITS[limit][resolveEntitlementPlan(user)];
}
```

- [ ] **Step 4: Export the module**

Modify `packages/utils/src/index.ts`:

```ts
export * from './entitlements';

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] || '';
}
```

Keep the existing `capitalize` and `debounce` exports below the new export line.

- [ ] **Step 5: Run the shared tests**

Run:

```bash
bun test packages/utils/src/entitlements.test.ts
```

Expected: PASS.

---

### Task 2: Wire Workspace Dependencies

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Modify: `bun.lock` after install

- [ ] **Step 1: Add workspace dependency to API**

In `apps/api/package.json`, add the dependency inside `"dependencies"`:

```json
"@utils-plane/utils": "workspace:*"
```

Keep the dependency list alphabetical near the other `@utils-plane/*` packages.

- [ ] **Step 2: Add workspace dependency to Web**

In `apps/web/package.json`, add the dependency inside `"dependencies"`:

```json
"@utils-plane/utils": "workspace:*"
```

Keep it near `@utils-plane/auth` and `@utils-plane/api-client`.

- [ ] **Step 3: Refresh lockfile**

Run:

```bash
bun install
```

Expected: `bun.lock` updates only if Bun needs to record the new workspace links.

- [ ] **Step 4: Verify TypeScript can resolve the package**

Run:

```bash
bun run build --filter=@utils-plane/utils
```

Expected: PASS.

---

### Task 3: Enforce Upload Limits Through Entitlements

**Files:**

- Modify: `apps/api/src/modules/files/files.controller.ts`
- Modify: `apps/api/src/modules/files/files.service.ts`
- Modify: `apps/api/src/modules/files/files.controller.test.ts`

- [ ] **Step 1: Add source-boundary tests**

Extend `apps/api/src/modules/files/files.controller.test.ts` with:

```ts
it('passes the current user into file upload entitlement checks', () => {
  const source = readFileSync(
    join(import.meta.dir, 'files.controller.ts'),
    'utf8'
  );

  expect(source).toContain('user');
  expect(source).toContain('this.filesService.upload(');
  expect(source).toContain('user ?? null');
});

it('uses shared entitlement upload limits instead of local constants', () => {
  const source = readFileSync(
    join(import.meta.dir, 'files.service.ts'),
    'utf8'
  );

  expect(source).toContain("getLimit(user, 'upload.maxFileSize')");
  expect(source).not.toContain('ANONYMOUS_MAX_SIZE');
  expect(source).not.toContain('USER_MAX_SIZE');
});
```

- [ ] **Step 2: Run the API file tests and verify they fail**

Run:

```bash
bun test apps/api/src/modules/files/files.controller.test.ts
```

Expected: FAIL because upload still passes `user?.id` and file service still has local constants.

- [ ] **Step 3: Pass the full user from controller**

Modify the upload call in `apps/api/src/modules/files/files.controller.ts`:

```ts
const result = await this.filesService.upload(
  file.buffer,
  {
    filename: normalizeUploadedFilename(file.originalname),
    mimeType: file.mimetype,
    size: file.size,
  },
  user ?? null
);
```

- [ ] **Step 4: Replace file service constants with shared limits**

Modify the imports and upload signature in `apps/api/src/modules/files/files.service.ts`:

```ts
import { db, files, type File, type User } from '@utils-plane/db';
import { getLimit } from '@utils-plane/utils';
```

Remove:

```ts
const ANONYMOUS_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const USER_MAX_SIZE = 50 * 1024 * 1024; // 50MB
```

Change the upload signature:

```ts
async upload(
  file: Buffer,
  meta: UploadMeta,
  user?: Pick<User, 'id' | 'plan' | 'role'> | null
): Promise<File> {
```

Replace size limit logic:

```ts
const maxSize = getLimit(
  user ? { userId: user.id, plan: user.plan, role: user.role } : null,
  'upload.maxFileSize'
);
if (meta.size > maxSize) {
  throw new BadRequestException({
    code: ErrorCodes.FILE_TOO_LARGE,
    message: `File size exceeds limit of ${maxSize / 1024 / 1024}MB`,
  });
}
```

Replace user usage:

```ts
const prefix = user?.id ?? 'anonymous';
const expiresAt = user?.id ? null : new Date(Date.now() + 24 * 60 * 60 * 1000);
```

And database insert:

```ts
userId: user?.id ?? null,
```

Log line:

```ts
`Uploaded file ${newFile.id} by user ${user?.id ?? 'anonymous'}`;
```

- [ ] **Step 5: Run upload tests**

Run:

```bash
bun test apps/api/src/modules/files/files.controller.test.ts
```

Expected: PASS.

---

### Task 4: Gate Server Tasks Through Entitlements

**Files:**

- Modify: `apps/api/src/modules/tasks/tasks.controller.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.test.ts`

- [ ] **Step 1: Add task entitlement tests**

Extend `apps/api/src/modules/tasks/tasks.service.test.ts`:

```ts
it('checks server task entitlement before creating a task', () => {
  const source = readFileSync(
    join(import.meta.dir, 'tasks.service.ts'),
    'utf8'
  );

  expect(source).toContain("canUseFeature(user, 'task.serverProcessing')");
  expect(source).toContain('assertCanCreateTask');
});

it('receives the full current user from task controller', () => {
  const source = readFileSync(
    join(import.meta.dir, 'tasks.controller.ts'),
    'utf8'
  );

  expect(source).toContain('const user = req.user');
  expect(source).toContain('this.tasksService.create(');
  expect(source).toContain('user ?? null');
});
```

- [ ] **Step 2: Run task tests and verify they fail**

Run:

```bash
bun test apps/api/src/modules/tasks/tasks.service.test.ts
```

Expected: FAIL because task service has no entitlement check and controller passes only `userId`.

- [ ] **Step 3: Pass the full user from task controller**

In `apps/api/src/modules/tasks/tasks.controller.ts`, replace create user handling:

```ts
const user = req.user;
return this.tasksService.create(
  {
    type: dto.type,
    inputFileIds: dto.inputFileIds,
    inputConfig: dto.inputConfig ?? {},
  },
  user ?? null
);
```

In retry, replace the user handling:

```ts
const user = req.user;
const original = await this.tasksService.getById(id, user?.id);
return this.tasksService.create(
  {
    type: original.type,
    inputFileIds: original.inputFileIds as string[],
    inputConfig: (original.inputConfig as Record<string, unknown>) ?? {},
  },
  user ?? null
);
```

- [ ] **Step 4: Add task entitlement guard**

Modify imports in `apps/api/src/modules/tasks/tasks.service.ts`:

```ts
import { db, tasks, type User } from '@utils-plane/db';
import { canUseFeature } from '@utils-plane/utils';
```

Change create signature:

```ts
async create(
  input: CreateTaskInput,
  user?: Pick<User, 'id' | 'plan' | 'role'> | null
): Promise<Task> {
  this.assertCanCreateTask(input.type, user);
```

Change insert `userId`:

```ts
userId: user?.id ?? null,
```

Add private method before `getQueue`:

```ts
private assertCanCreateTask(
  type: TaskType,
  user?: Pick<User, 'id' | 'plan' | 'role'> | null
): void {
  if (this.isServerTask(type)) {
    const allowed = canUseFeature(
      user ? { userId: user.id, plan: user.plan, role: user.role } : null,
      'task.serverProcessing'
    );

    if (!allowed) {
      throw new ForbiddenException({
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Sign in is required for server processing tasks',
      });
    }
  }
}

private isServerTask(type: TaskType): boolean {
  switch (type) {
    case 'compress':
    case 'convert':
    case 'image_watermark':
      return false;
    case 'image_id_photo':
    case 'pdf_merge':
    case 'pdf_split':
    case 'pdf_to_image':
    case 'pdf_to_text':
    case 'image_to_pdf':
    case 'pdf_rotate':
    case 'pdf_watermark':
    case 'pdf_encrypt':
    case 'pdf_compress':
    case 'pdf_metadata':
    case 'pdf_rearrange':
    case 'pdf_from_document':
    case 'font_convert':
      return true;
  }
}
```

- [ ] **Step 5: Run task tests**

Run:

```bash
bun test apps/api/src/modules/tasks/tasks.service.test.ts
```

Expected: PASS.

---

### Task 5: Add Tool Metadata Entitlement Keys

**Files:**

- Modify: `apps/web/src/lib/tools/tool-metadata.ts`
- Modify: `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`

- [ ] **Step 1: Add metadata tests**

Extend `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`:

```ts
it('assigns entitlement feature keys to commercial-ready tools', () => {
  expect(getToolByHref('/image/animation')?.featureKeys).toEqual(
    expect.arrayContaining([
      'image.animation.gif',
      'image.animation.apng',
      'image.animation.advancedCompression',
    ])
  );
  expect(getToolByHref('/image/stitch')?.featureKeys).toEqual(
    expect.arrayContaining(['image.stitch.basic', 'image.stitch.brandFooter'])
  );
  expect(getToolByHref('/pdf/from-document')?.featureKeys).toEqual(
    expect.arrayContaining([
      'pdf.document.localExport',
      'pdf.document.serverExport',
    ])
  );
});
```

- [ ] **Step 2: Run metadata tests and verify they fail**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-metadata.test.ts
```

Expected: FAIL because `featureKeys` does not exist yet.

- [ ] **Step 3: Add entitlement fields to ToolMeta**

Modify `apps/web/src/lib/tools/tool-metadata.ts`:

```ts
import type { FeatureKey, LimitKey } from '@utils-plane/utils';
```

Extend `ToolMeta`:

```ts
featureKeys?: FeatureKey[];
limitKeys?: LimitKey[];
```

Add to `/image/animation`:

```ts
featureKeys: [
  'image.animation.gif',
  'image.animation.apng',
  'image.animation.advancedCompression',
],
limitKeys: [
  'image.animation.maxInputFiles',
  'image.animation.maxFileSize',
  'image.animation.maxFrames',
  'image.animation.maxOutputWidth',
],
```

Add to `/image/stitch`:

```ts
featureKeys: ['image.stitch.basic', 'image.stitch.brandFooter'],
limitKeys: [
  'image.stitch.maxFiles',
  'image.stitch.maxFileSize',
  'image.stitch.maxCanvasPixels',
],
```

Add to `/pdf/from-document`:

```ts
featureKeys: ['pdf.document.localExport', 'pdf.document.serverExport'],
```

- [ ] **Step 4: Run metadata tests**

Run:

```bash
bun --cwd apps/web test src/components/tools/__tests__/tool-metadata.test.ts
```

Expected: PASS.

---

### Task 6: Reuse Shared Entitlements in Local Image Tools

**Files:**

- Modify: `apps/web/src/lib/processing/image-animation-client.ts`
- Modify: `apps/web/src/lib/processing/image-stitch-client.ts`
- Test: existing tests in `apps/web/src/lib/processing/__tests__/`

- [ ] **Step 1: Update image animation entitlement helper**

In `apps/web/src/lib/processing/image-animation-client.ts`, import shared helpers:

```ts
import { canUseFeature, getLimit } from '@utils-plane/utils';
```

Replace the current `getImageAnimationEntitlements` body:

```ts
export function getImageAnimationEntitlements(
  session: unknown
): AnimationEntitlements {
  const user = session ? { userId: 'signed-in' } : null;
  const isLoggedIn = Boolean(session);

  return {
    maxInputFiles: getLimit(user, 'image.animation.maxInputFiles'),
    maxFileSize: getLimit(user, 'image.animation.maxFileSize'),
    maxFrames: getLimit(user, 'image.animation.maxFrames'),
    maxCanvasPixels: getLimit(user, 'image.animation.maxCanvasPixels'),
    maxTotalFramePixels: getLimit(user, 'image.animation.maxTotalFramePixels'),
    maxOutputWidth: getLimit(user, 'image.animation.maxOutputWidth'),
    isLoggedIn,
    isCommercial: isLoggedIn,
    canExportGif: canUseFeature(user, 'image.animation.gif'),
    canExportApng: canUseFeature(user, 'image.animation.apng'),
    canUseAdvancedCompression: canUseFeature(
      user,
      'image.animation.advancedCompression'
    ),
    canBatchProcess: canUseFeature(user, 'image.animation.batch'),
    canSaveHistory: isLoggedIn,
  };
}
```

Keep `DEFAULT_IMAGE_ANIMATION_LIMITS` exported for compatibility during this task; remove it only in a future cleanup after verifying no callers depend on it.

- [ ] **Step 2: Update image stitch entitlement helper**

In `apps/web/src/lib/processing/image-stitch-client.ts`, import shared helpers:

```ts
import { canUseFeature, getLimit } from '@utils-plane/utils';
```

Replace the current `getImageStitchEntitlements` body:

```ts
export function getImageStitchEntitlements(
  session: unknown
): ImageStitchEntitlements {
  const user = session ? { userId: 'signed-in' } : null;
  const isLoggedIn = Boolean(session);

  return {
    maxFiles: getLimit(user, 'image.stitch.maxFiles'),
    maxFileSize: getLimit(user, 'image.stitch.maxFileSize'),
    maxCanvasPixels: getLimit(user, 'image.stitch.maxCanvasPixels'),
    isLoggedIn,
    canBatchExport: canUseFeature(user, 'image.stitch.batch'),
    canUseBrandFooter: canUseFeature(user, 'image.stitch.brandFooter'),
    canUseWatermarkTemplate: canUseFeature(user, 'image.stitch.brandFooter'),
    canSaveHistory: isLoggedIn,
  };
}
```

- [ ] **Step 3: Run processing tests**

Run:

```bash
bun --cwd apps/web test src/lib/processing/__tests__/image-animation-client.test.ts src/lib/processing/__tests__/image-stitch-client.test.ts
```

Expected: PASS. If a test imports old constants and asserts exact values, update it to assert through `getImageAnimationEntitlements(null)` or `getImageStitchEntitlements(null)`.

---

### Task 7: Full Verification and Commit

**Files:**

- All files changed in Tasks 1-6.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun test packages/utils/src/entitlements.test.ts
bun test apps/api/src/modules/files/files.controller.test.ts
bun test apps/api/src/modules/tasks/tasks.service.test.ts
bun --cwd apps/web test src/components/tools/__tests__/tool-metadata.test.ts
bun --cwd apps/web test src/lib/processing/__tests__/image-animation-client.test.ts src/lib/processing/__tests__/image-stitch-client.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run package builds**

Run:

```bash
bun run build --filter=@utils-plane/utils --filter=@utils-plane/api --filter=@utils-plane/web
```

Expected: all selected builds PASS.

- [ ] **Step 3: Run formatting check**

Run:

```bash
bunx prettier --check packages/utils/src/entitlements.ts packages/utils/src/entitlements.test.ts apps/api/src/modules/files/files.controller.ts apps/api/src/modules/files/files.service.ts apps/api/src/modules/tasks/tasks.controller.ts apps/api/src/modules/tasks/tasks.service.ts apps/web/src/lib/tools/tool-metadata.ts apps/web/src/lib/processing/image-animation-client.ts apps/web/src/lib/processing/image-stitch-client.ts
```

Expected: PASS.

- [ ] **Step 4: Inspect diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; changed files are only the entitlement implementation, related package files, and targeted tests.

- [ ] **Step 5: Commit**

Use a Chinese commit message:

```bash
git add packages/utils/src/entitlements.ts packages/utils/src/entitlements.test.ts packages/utils/src/index.ts apps/api/package.json apps/web/package.json bun.lock apps/api/src/modules/files/files.controller.ts apps/api/src/modules/files/files.service.ts apps/api/src/modules/files/files.controller.test.ts apps/api/src/modules/tasks/tasks.controller.ts apps/api/src/modules/tasks/tasks.service.ts apps/api/src/modules/tasks/tasks.service.test.ts apps/web/src/lib/tools/tool-metadata.ts apps/web/src/components/tools/__tests__/tool-metadata.test.ts apps/web/src/lib/processing/image-animation-client.ts apps/web/src/lib/processing/image-stitch-client.ts
git commit -m "feat: 添加统一权益系统"
```

Expected: commit succeeds.

---

## Self-Review Notes

- Spec coverage: implements the first recommended roadmap item, “统一权益层”，and connects it to upload limits, server task gating, Web metadata, and two existing local commercial-ready tools.
- Scope intentionally excludes payment, team workspaces, license checks, and a full task handler registry.
- Type consistency: `FeatureKey`, `LimitKey`, `EntitlementUser`, and helper names are defined in Task 1 and reused consistently in later tasks.
- Test coverage: shared unit tests plus API source-boundary tests and Web behavior tests cover the first integration slice.
