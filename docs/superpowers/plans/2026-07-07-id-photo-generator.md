# ID Photo Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/image/id-photo` tool that uploads a portrait photo, changes the background color, crops it to a standard ID photo size, and saves the result through the existing task and file systems.

**Architecture:** The web app collects options and creates an `image_id_photo` task. The API routes that task to `image-queue`; `ImageProcessor` delegates to a focused `IdPhotoService`, which validates config, obtains a portrait mask through `PortraitSegmentationService`, composites the selected background with `sharp`, and uploads the output file.

**Tech Stack:** Next.js 14, React 18, NestJS 11, BullMQ, Drizzle, Zod, class-validator, sharp, onnxruntime-node, Vitest.

---

## File Structure

- Create `packages/validators/src/id-photo.ts`: shared preset, color, crop, and task config schemas.
- Modify `packages/validators/src/tasks.ts`: add `image_id_photo` to the task enum and export ID photo schemas.
- Modify `packages/validators/src/index.ts`: export `id-photo` helpers.
- Modify `packages/db/src/schema/tasks.ts`: add `image_id_photo` to the Drizzle enum.
- Create a Drizzle migration in `packages/db/drizzle/`: add the enum value.
- Modify `apps/api/src/modules/tasks/dto/tasks.dto.ts`: add `image_id_photo` to Swagger/class-validator enum.
- Modify `apps/api/src/modules/tasks/tasks.service.ts`: route `image_id_photo` to `image-queue`.
- Create `apps/api/src/modules/tasks/services/id-photo.service.ts`: ID photo rendering orchestration.
- Create `apps/api/src/modules/tasks/services/portrait-segmentation.service.ts`: ONNX model wrapper behind a narrow interface.
- Modify `apps/api/src/modules/tasks/tasks.module.ts`: register the new services.
- Modify `apps/api/src/modules/tasks/processors/image.processor.ts`: add the `image_id_photo` branch.
- Modify `apps/api/src/common/errors/error-codes.ts`: add ID photo error codes.
- Modify `apps/api/package.json`: add `onnxruntime-node`.
- Create `apps/web/src/lib/id-photo/presets.ts`: UI-facing preset metadata derived from shared keys.
- Create `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`: tool page.
- Create `apps/web/src/components/tools/id-photo-options.tsx`: preset/background/output controls.
- Modify `apps/web/src/lib/tools/tool-metadata.ts`: add image tool metadata.
- Modify `apps/web/src/hooks/api/types.ts`: add `image_id_photo` to task type union.
- Modify `apps/web/src/app/[locale]/(app)/tasks/page.tsx`: classify and label the task.
- Modify `apps/web/messages/zh.json` and `apps/web/messages/en.json`: add UI copy.
- Modify tests under `apps/web/src/components/tools/__tests__`, `apps/web/src/app/[locale]/(app)/__tests__`, and `apps/web/src/lib/processing/__tests__` as described below.

---

### Task 1: Shared ID Photo Validation

**Files:**
- Create: `packages/validators/src/id-photo.ts`
- Modify: `packages/validators/src/tasks.ts`
- Modify: `packages/validators/src/index.ts`
- Test: `packages/validators/src/id-photo.test.ts`

- [ ] **Step 1: Write the failing validator tests**

Create `packages/validators/src/id-photo.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
  idPhotoTaskConfigSchema,
  idPhotoPresetEnum,
  normalizeHexColor,
} from './id-photo';

describe('id photo validators', () => {
  it('accepts a valid one inch task config', () => {
    const result = idPhotoTaskConfigSchema.parse({
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
      crop: { x: 0.5, y: 0.48, scale: 1.1 },
    });

    expect(result.preset).toBe('one_inch');
    expect(result.backgroundColor).toBe('#438edb');
  });

  it('rejects invalid preset values', () => {
    expect(() => idPhotoPresetEnum.parse('visa_us')).toThrow();
  });

  it('normalizes uppercase hex colors', () => {
    expect(normalizeHexColor('#FF0000')).toBe('#ff0000');
  });

  it('rejects non-hex background colors', () => {
    expect(() =>
      idPhotoTaskConfigSchema.parse({
        preset: 'passport',
        backgroundColor: 'blue',
        outputType: 'image/png',
        dpi: 300,
      })
    ).toThrow();
  });

  it('rejects crop scale outside the supported range', () => {
    expect(() =>
      idPhotoTaskConfigSchema.parse({
        preset: 'passport',
        backgroundColor: '#ffffff',
        outputType: 'image/jpeg',
        dpi: 300,
        crop: { x: 0.5, y: 0.5, scale: 4 },
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bun test packages/validators/src/id-photo.test.ts
```

Expected: FAIL because `id-photo.ts` does not exist.

- [ ] **Step 3: Add the validator implementation**

Create `packages/validators/src/id-photo.ts`:

```ts
import { z } from 'zod';

export const idPhotoPresetEnum = z.enum([
  'one_inch',
  'two_inch',
  'small_one_inch',
  'passport',
]);

export const idPhotoOutputTypeEnum = z.enum(['image/jpeg', 'image/png']);

export const idPhotoCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().min(0.5).max(3),
});

export const idPhotoBackgroundColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform(value => value.toLowerCase());

export const idPhotoTaskConfigSchema = z.object({
  preset: idPhotoPresetEnum,
  backgroundColor: idPhotoBackgroundColorSchema,
  outputType: idPhotoOutputTypeEnum.default('image/jpeg'),
  dpi: z.literal(300).default(300),
  crop: idPhotoCropSchema.optional(),
});

export const idPhotoPresetSpecs = {
  one_inch: {
    key: 'one_inch',
    widthPx: 295,
    heightPx: 413,
    dpi: 300,
    defaultBackground: '#438edb',
  },
  two_inch: {
    key: 'two_inch',
    widthPx: 413,
    heightPx: 626,
    dpi: 300,
    defaultBackground: '#438edb',
  },
  small_one_inch: {
    key: 'small_one_inch',
    widthPx: 260,
    heightPx: 378,
    dpi: 300,
    defaultBackground: '#438edb',
  },
  passport: {
    key: 'passport',
    widthPx: 413,
    heightPx: 531,
    dpi: 300,
    defaultBackground: '#ffffff',
  },
} as const;

export type IdPhotoPreset = z.infer<typeof idPhotoPresetEnum>;
export type IdPhotoOutputType = z.infer<typeof idPhotoOutputTypeEnum>;
export type IdPhotoCrop = z.infer<typeof idPhotoCropSchema>;
export type IdPhotoTaskConfig = z.infer<typeof idPhotoTaskConfigSchema>;

export function normalizeHexColor(value: string): string {
  return idPhotoBackgroundColorSchema.parse(value);
}
```

Modify `packages/validators/src/tasks.ts`:

```ts
export const taskTypeEnum = z.enum([
  'compress',
  'convert',
  'image_watermark',
  'image_id_photo',
  'pdf_merge',
  'pdf_split',
  'pdf_to_image',
  'font_convert',
  'pdf_to_text',
  'image_to_pdf',
  'pdf_rotate',
  'pdf_watermark',
  'pdf_encrypt',
  'pdf_compress',
  'pdf_metadata',
  'pdf_rearrange',
]);
```

Modify `packages/validators/src/index.ts` by adding this line:

```ts
export * from './id-photo';
```

- [ ] **Step 4: Run the validator tests**

Run:

```bash
bun test packages/validators/src/id-photo.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/validators/src/id-photo.ts packages/validators/src/id-photo.test.ts packages/validators/src/tasks.ts packages/validators/src/index.ts
git commit -m "feat(validators): add id photo task validation"
```

---

### Task 2: Task Type, Queue Routing, and API Contract

**Files:**
- Modify: `packages/db/src/schema/tasks.ts`
- Create: `packages/db/drizzle/<generated>_add_image_id_photo.sql`
- Modify: `apps/api/src/modules/tasks/dto/tasks.dto.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/web/src/hooks/api/types.ts`
- Test: `apps/api/src/modules/tasks/tasks.service.spec.ts`

- [ ] **Step 1: Add a failing queue routing test**

Create `apps/api/src/modules/tasks/tasks.service.spec.ts` with a focused private-method test:

```ts
import { describe, expect, it, vi } from 'bun:test';
import { TasksService } from './tasks.service';

function queue(name: string) {
  return { name, add: vi.fn(), getWaitingCount: vi.fn(), getActiveCount: vi.fn() };
}

describe('TasksService queue routing', () => {
  it('routes image_id_photo tasks to image queue', () => {
    const service = new TasksService(
      queue('image-queue') as any,
      queue('pdf-queue') as any,
      queue('font-queue') as any
    );

    expect((service as any).getQueue('image_id_photo').name).toBe('image-queue');
  });
});
```

- [ ] **Step 2: Run the focused API test and verify it fails**

Run:

```bash
bun test apps/api/src/modules/tasks/tasks.service.spec.ts
```

Expected: FAIL because `image_id_photo` is not routed.

- [ ] **Step 3: Update task enums and routing**

Modify `packages/db/src/schema/tasks.ts` by adding `'image_id_photo'` to the task enum immediately after `'image_watermark'`.

Create a Drizzle migration with:

```bash
cd packages/db
bunx drizzle-kit generate
```

The generated SQL must include:

```sql
ALTER TYPE "public"."task_type" ADD VALUE 'image_id_photo';
```

Modify `apps/api/src/modules/tasks/dto/tasks.dto.ts` by adding `'image_id_photo'` to `TASK_TYPES`.

Modify `apps/api/src/modules/tasks/tasks.service.ts`:

```ts
      case 'compress':
      case 'convert':
      case 'image_watermark':
      case 'image_id_photo':
        return this.imageQueue;
```

Modify `apps/web/src/hooks/api/types.ts` by adding:

```ts
  | 'image_id_photo'
```

- [ ] **Step 4: Regenerate API types**

Run:

```bash
cd apps/api && bun run openapi:export
cd ../../packages/api-client && bun run generate
```

Expected: `apps/api/openapi.json` and `packages/api-client` include `image_id_photo`.

- [ ] **Step 5: Run focused validation**

Run:

```bash
bun test apps/api/src/modules/tasks/tasks.service.spec.ts
bun run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/tasks.ts packages/db/drizzle apps/api/src/modules/tasks/dto/tasks.dto.ts apps/api/src/modules/tasks/tasks.service.ts apps/api/openapi.json packages/api-client apps/web/src/hooks/api/types.ts apps/api/src/modules/tasks/tasks.service.spec.ts
git commit -m "feat(tasks): add image id photo task type"
```

---

### Task 3: Backend ID Photo Rendering Services

**Files:**
- Create: `apps/api/src/modules/tasks/services/portrait-segmentation.service.ts`
- Create: `apps/api/src/modules/tasks/services/id-photo.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.module.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/src/modules/tasks/services/id-photo.service.spec.ts`

- [ ] **Step 1: Add service tests with a fake segmentation service**

Create `apps/api/src/modules/tasks/services/id-photo.service.spec.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { IdPhotoService } from './id-photo.service';

describe('IdPhotoService', () => {
  it('renders a JPEG with the selected preset size and background color', async () => {
    const input = await sharp({
      create: {
        width: 500,
        height: 700,
        channels: 3,
        background: '#dddddd',
      },
    })
      .jpeg()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => ({
        mask: await sharp({
          create: {
            width: 500,
            height: 700,
            channels: 1,
            background: '#ffffff',
          },
        })
          .png()
          .toBuffer(),
        bounds: { x: 100, y: 80, width: 300, height: 520 },
        faceCount: 1,
      }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/jpeg',
      dpi: 300,
    });

    const metadata = await sharp(output.buffer).metadata();
    expect(metadata.width).toBe(295);
    expect(metadata.height).toBe(413);
    expect(output.mimeType).toBe('image/jpeg');
    expect(output.extension).toBe('jpg');
  });

  it('throws NO_FACE_DETECTED when the segmentation service reports zero faces', async () => {
    const input = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .png()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => ({
        mask: Buffer.alloc(0),
        faceCount: 0,
      }),
    } as any);

    await expect(
      service.render(input, {
        preset: 'passport',
        backgroundColor: '#ffffff',
        outputType: 'image/png',
        dpi: 300,
      })
    ).rejects.toMatchObject({ code: 'NO_FACE_DETECTED' });
  });
});
```

- [ ] **Step 2: Run the service tests and verify they fail**

Run:

```bash
bun test apps/api/src/modules/tasks/services/id-photo.service.spec.ts
```

Expected: FAIL because `IdPhotoService` does not exist.

- [ ] **Step 3: Add `onnxruntime-node`**

Run:

```bash
bun --cwd apps/api add onnxruntime-node
```

Expected: `apps/api/package.json` and `bun.lock` update.

- [ ] **Step 4: Implement portrait segmentation wrapper**

Create `apps/api/src/modules/tasks/services/portrait-segmentation.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

export type PortraitMask = {
  mask: Buffer;
  bounds?: { x: number; y: number; width: number; height: number };
  faceCount?: number;
};

@Injectable()
export class PortraitSegmentationService {
  private sessionPromise?: Promise<ort.InferenceSession>;

  async segment(input: Buffer): Promise<PortraitMask> {
    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height) {
      return { mask: Buffer.alloc(0), faceCount: 0 };
    }

    const session = await this.getSession();
    const size = 320;
    const raw = await sharp(input)
      .resize(size, size, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();

    const tensorData = new Float32Array(1 * 3 * size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const pixel = (y * size + x) * 3;
        const target = y * size + x;
        tensorData[target] = raw[pixel] / 255;
        tensorData[size * size + target] = raw[pixel + 1] / 255;
        tensorData[2 * size * size + target] = raw[pixel + 2] / 255;
      }
    }

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const result = await session.run({
      [inputName]: new ort.Tensor('float32', tensorData, [1, 3, size, size]),
    });
    const output = result[outputName];
    const maskValues = output.data as Float32Array;
    const maskBytes = Buffer.alloc(size * size);
    for (let i = 0; i < maskBytes.length; i += 1) {
      maskBytes[i] = Math.max(0, Math.min(255, Math.round(maskValues[i] * 255)));
    }

    const mask = await sharp(maskBytes, {
      raw: { width: size, height: size, channels: 1 },
    })
      .resize(metadata.width, metadata.height, { fit: 'fill' })
      .png()
      .toBuffer();

    return {
      mask,
      bounds: { x: 0, y: 0, width: metadata.width, height: metadata.height },
      faceCount: 1,
    };
  }

  private getSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      const modelPath =
        process.env.ID_PHOTO_SEGMENTATION_MODEL ??
        'apps/api/models/modnet.onnx';
      this.sessionPromise = ort.InferenceSession.create(modelPath);
    }
    return this.sessionPromise;
  }
}
```

- [ ] **Step 5: Implement ID photo rendering service**

Create `apps/api/src/modules/tasks/services/id-photo.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import {
  idPhotoPresetSpecs,
  idPhotoTaskConfigSchema,
  type IdPhotoTaskConfig,
} from '@utils-plane/validators';
import { PortraitSegmentationService } from './portrait-segmentation.service';

export class IdPhotoError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type IdPhotoRenderResult = {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

@Injectable()
export class IdPhotoService {
  constructor(private readonly segmentation: PortraitSegmentationService) {}

  async render(
    input: Buffer,
    rawConfig: IdPhotoTaskConfig
  ): Promise<IdPhotoRenderResult> {
    const config = idPhotoTaskConfigSchema.parse(rawConfig);
    const preset = idPhotoPresetSpecs[config.preset];
    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height) {
      throw new IdPhotoError('ID_PHOTO_RENDER_FAILED', 'File is not a valid image');
    }

    const mask = await this.segmentation.segment(input);
    if (mask.faceCount === 0) {
      throw new IdPhotoError('NO_FACE_DETECTED', 'No face detected');
    }
    if ((mask.faceCount ?? 1) > 1) {
      throw new IdPhotoError('MULTIPLE_FACES_DETECTED', 'Multiple faces detected');
    }
    if (!mask.mask.length) {
      throw new IdPhotoError('SEGMENTATION_FAILED', 'Portrait segmentation failed');
    }

    const base = await sharp(input).rotate().resize({
      width: preset.widthPx,
      height: preset.heightPx,
      fit: 'cover',
      position: 'centre',
    }).toBuffer();

    const alpha = await sharp(mask.mask)
      .resize(preset.widthPx, preset.heightPx, { fit: 'cover' })
      .toBuffer();

    const foreground = await sharp(base)
      .joinChannel(alpha)
      .png()
      .toBuffer();

    const background = await sharp({
      create: {
        width: preset.widthPx,
        height: preset.heightPx,
        channels: 3,
        background: hexToRgb(config.backgroundColor),
      },
    })
      .png()
      .composite([{ input: foreground, blend: 'over' }]);

    if (config.outputType === 'image/png') {
      return {
        buffer: await background.png({ compressionLevel: 9 }).toBuffer(),
        mimeType: 'image/png',
        extension: 'png',
      };
    }

    return {
      buffer: await background.jpeg({ quality: 92, mozjpeg: true }).toBuffer(),
      mimeType: 'image/jpeg',
      extension: 'jpg',
    };
  }
}
```

- [ ] **Step 6: Register services**

Modify `apps/api/src/modules/tasks/tasks.module.ts`:

```ts
import { IdPhotoService } from './services/id-photo.service';
import { PortraitSegmentationService } from './services/portrait-segmentation.service';

providers: [
  TasksService,
  ImageProcessor,
  PdfProcessor,
  FontProcessor,
  ImageService,
  PdfService,
  FontService,
  IdPhotoService,
  PortraitSegmentationService,
],
```

- [ ] **Step 7: Run tests**

Run:

```bash
bun test apps/api/src/modules/tasks/services/id-photo.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json bun.lock apps/api/src/modules/tasks/services/portrait-segmentation.service.ts apps/api/src/modules/tasks/services/id-photo.service.ts apps/api/src/modules/tasks/services/id-photo.service.spec.ts apps/api/src/modules/tasks/tasks.module.ts
git commit -m "feat(api): add id photo rendering services"
```

---

### Task 4: Image Processor Integration

**Files:**
- Modify: `apps/api/src/modules/tasks/processors/image.processor.ts`
- Modify: `apps/api/src/common/errors/error-codes.ts`
- Test: `apps/api/src/modules/tasks/processors/image.processor.spec.ts`

- [ ] **Step 1: Add processor test for `image_id_photo`**

Create or extend `apps/api/src/modules/tasks/processors/image.processor.spec.ts`:

```ts
import { expect, it, vi } from 'bun:test';
import { ImageProcessor } from './image.processor';

it('processes image_id_photo tasks through IdPhotoService', async () => {
  const filesService = {
    getById: vi.fn().mockResolvedValue({
      id: 'file-1',
      filename: 'portrait.jpg',
      mimeType: 'image/jpeg',
      storageKey: 'uploads/portrait.jpg',
    }),
    download: vi.fn().mockResolvedValue(Buffer.from('input')),
    upload: vi.fn().mockResolvedValue({ id: 'output-1' }),
  };
  const tasksService = {
    getById: vi.fn().mockResolvedValue({
      id: 'task-1',
      type: 'image_id_photo',
      userId: 'user-1',
      inputFileIds: ['file-1'],
      inputConfig: {
        preset: 'one_inch',
        backgroundColor: '#ffffff',
        outputType: 'image/jpeg',
        dpi: 300,
      },
    }),
    markProcessing: vi.fn(),
    updateProgress: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  };
  const idPhotoService = {
    render: vi.fn().mockResolvedValue({
      buffer: Buffer.from('output'),
      mimeType: 'image/jpeg',
      extension: 'jpg',
    }),
  };
  const processor = new ImageProcessor(
    {} as any,
    filesService as any,
    tasksService as any,
    idPhotoService as any
  );

  await processor.process({
    id: 'job-1',
    data: { taskId: 'task-1' },
    attemptsMade: 0,
    updateProgress: vi.fn(),
    opts: {},
  } as any);

  expect(idPhotoService.render).toHaveBeenCalled();
  expect(filesService.upload).toHaveBeenCalledWith(
    Buffer.from('output'),
    expect.objectContaining({
      filename: 'id-photo-one_inch-portrait.jpg',
      mimeType: 'image/jpeg',
    }),
    'user-1'
  );
  expect(tasksService.markCompleted).toHaveBeenCalledWith('task-1', 'output-1');
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
bun test apps/api/src/modules/tasks/processors/image.processor.spec.ts
```

Expected: FAIL because `ImageProcessor` does not accept `IdPhotoService`.

- [ ] **Step 3: Add error codes**

Modify `apps/api/src/common/errors/error-codes.ts` by adding:

```ts
  NO_FACE_DETECTED: 'NO_FACE_DETECTED',
  MULTIPLE_FACES_DETECTED: 'MULTIPLE_FACES_DETECTED',
  FACE_TOO_SMALL: 'FACE_TOO_SMALL',
  SEGMENTATION_FAILED: 'SEGMENTATION_FAILED',
  UNSUPPORTED_PRESET: 'UNSUPPORTED_PRESET',
  INVALID_BACKGROUND_COLOR: 'INVALID_BACKGROUND_COLOR',
  ID_PHOTO_RENDER_FAILED: 'ID_PHOTO_RENDER_FAILED',
```

- [ ] **Step 4: Integrate `IdPhotoService` into the processor**

Modify imports in `apps/api/src/modules/tasks/processors/image.processor.ts`:

```ts
import { IdPhotoService, IdPhotoError } from '../services/id-photo.service';
```

Modify constructor:

```ts
  constructor(
    private readonly imageService: ImageService,
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
    private readonly idPhotoService: IdPhotoService
  ) {
    super();
  }
```

Add switch branch:

```ts
        case 'image_id_photo':
          return await this.handleIdPhoto(task, job);
```

Add handler:

```ts
  private async handleIdPhoto(task: ImageTask, job: Job): Promise<unknown> {
    const fileId = task.inputFileIds?.[0];
    if (!fileId) throw new Error('No input file specified');
    const inputFile = await this.filesService.getById(fileId);
    if (!inputFile.mimeType.startsWith('image/')) {
      throw new Error(`INVALID_FILE_TYPE: File ${inputFile.filename} is not an image`);
    }

    const inputBuffer = await this.filesService.download(inputFile.storageKey);
    await this.reportProgress(task.id, job, 20);

    try {
      const output = await this.idPhotoService.render(
        inputBuffer,
        task.inputConfig as any
      );
      await this.reportProgress(task.id, job, 80);

      const base = inputFile.filename.replace(/\.[^.]+$/, '');
      const preset =
        typeof (task.inputConfig as any)?.preset === 'string'
          ? (task.inputConfig as any).preset
          : 'id';
      const outputFile = await this.filesService.upload(
        output.buffer,
        {
          filename: `id-photo-${preset}-${base}.${output.extension}`,
          mimeType: output.mimeType,
          size: output.buffer.length,
        },
        task.userId ?? undefined
      );
      await this.reportProgress(task.id, job, 95);

      await this.tasksService.markCompleted(task.id, outputFile.id);
      await job.updateProgress(100);
      return { outputFileId: outputFile.id };
    } catch (err) {
      if (err instanceof IdPhotoError) {
        await this.tasksService.markFailed(task.id, err.code, err.message);
      }
      throw err;
    }
  }
```

- [ ] **Step 5: Run processor tests**

Run:

```bash
bun test apps/api/src/modules/tasks/processors/image.processor.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/tasks/processors/image.processor.ts apps/api/src/modules/tasks/processors/image.processor.spec.ts apps/api/src/common/errors/error-codes.ts
git commit -m "feat(api): process image id photo tasks"
```

---

### Task 5: Web Tool Metadata and Catalog

**Files:**
- Modify: `apps/web/src/lib/tools/tool-metadata.ts`
- Modify: `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`
- Modify: `apps/web/src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx`

- [ ] **Step 1: Add failing metadata tests**

Modify `apps/web/src/components/tools/__tests__/tool-metadata.test.ts`:

```ts
it('registers the id photo generator as a server image tool', () => {
  const tool = getToolByHref('/image/id-photo');
  expect(tool?.key).toBe('imageIdPhoto');
  expect(tool?.processing).toBe('server');
  expect(tool?.retention).toBe('account-files');
});
```

Update the image tool count assertion from `5` to `6`.

- [ ] **Step 2: Run metadata test and verify it fails**

Run:

```bash
bun --cwd apps/web test tool-metadata
```

Expected: FAIL because `/image/id-photo` is not registered.

- [ ] **Step 3: Add tool metadata**

Modify `apps/web/src/lib/tools/tool-metadata.ts` imports:

```ts
  BadgeCheck,
```

Add to `imageTools` after `imageWatermark`:

```ts
  {
    key: 'imageIdPhoto',
    href: '/image/id-photo',
    icon: BadgeCheck,
    titleKey: 'ToolCatalog.tools.imageIdPhoto.title',
    descriptionKey: 'ToolCatalog.tools.imageIdPhoto.description',
    categoryKey: 'ToolCatalog.categories.imageConvert',
    processing: 'server',
    retention: 'account-files',
    requiresLogin: true,
    recommended: true,
    tags: ['id-photo', 'background', 'crop'],
  },
```

- [ ] **Step 4: Run metadata and catalog tests**

Run:

```bash
bun --cwd apps/web test tool-metadata catalog-pages
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tools/tool-metadata.ts apps/web/src/components/tools/__tests__/tool-metadata.test.ts apps/web/src/app/[locale]/(app)/__tests__/catalog-pages.test.tsx
git commit -m "feat(web): register id photo image tool"
```

---

### Task 6: Web ID Photo Page

**Files:**
- Create: `apps/web/src/lib/id-photo/presets.ts`
- Create: `apps/web/src/components/tools/id-photo-options.tsx`
- Create: `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/__tests__/tool-detail-adoption.test.ts`

- [ ] **Step 1: Add tool-detail adoption test**

Modify `apps/web/src/app/[locale]/(app)/__tests__/tool-detail-adoption.test.ts` by adding:

```ts
['/image/id-photo', 'src/app/[locale]/(app)/image/id-photo/page.tsx'],
```

- [ ] **Step 2: Run the adoption test and verify it fails**

Run:

```bash
bun --cwd apps/web test tool-detail-adoption
```

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Create preset metadata**

Create `apps/web/src/lib/id-photo/presets.ts`:

```ts
export const idPhotoPresetOptions = [
  { key: 'one_inch', labelKey: 'presets.oneInch', size: '295 x 413' },
  { key: 'two_inch', labelKey: 'presets.twoInch', size: '413 x 626' },
  { key: 'small_one_inch', labelKey: 'presets.smallOneInch', size: '260 x 378' },
  { key: 'passport', labelKey: 'presets.passport', size: '413 x 531' },
] as const;

export const idPhotoBackgroundOptions = [
  { key: 'blue', color: '#438edb', labelKey: 'backgrounds.blue' },
  { key: 'white', color: '#ffffff', labelKey: 'backgrounds.white' },
  { key: 'red', color: '#d82727', labelKey: 'backgrounds.red' },
] as const;
```

- [ ] **Step 4: Create options component**

Create `apps/web/src/components/tools/id-photo-options.tsx`:

```tsx
'use client';

import { idPhotoBackgroundOptions, idPhotoPresetOptions } from '@/lib/id-photo/presets';

export type IdPhotoOptionsState = {
  preset: 'one_inch' | 'two_inch' | 'small_one_inch' | 'passport';
  backgroundColor: string;
  outputType: 'image/jpeg' | 'image/png';
  crop: { x: number; y: number; scale: number };
};

type Props = {
  value: IdPhotoOptionsState;
  onChange: (value: IdPhotoOptionsState) => void;
  t: (key: string) => string;
  disabled?: boolean;
};

export function IdPhotoOptions({ value, onChange, t, disabled }: Props) {
  return (
    <div className="space-y-5 rounded-md border border-border p-4">
      <div className="space-y-2">
        <label className="text-xs font-mono text-muted-foreground">
          {t('preset')}
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {idPhotoPresetOptions.map(option => (
            <button
              key={option.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, preset: option.key })}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                value.preset === option.key
                  ? 'border-foreground bg-muted'
                  : 'border-border'
              }`}
            >
              <span className="block font-medium">{t(option.labelKey)}</span>
              <span className="text-xs text-muted-foreground">{option.size}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-mono text-muted-foreground">
          {t('background')}
        </label>
        <div className="flex flex-wrap gap-2">
          {idPhotoBackgroundOptions.map(option => (
            <button
              key={option.key}
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({ ...value, backgroundColor: option.color })
              }
              className={`flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${
                value.backgroundColor === option.color
                  ? 'border-foreground bg-muted'
                  : 'border-border'
              }`}
            >
              <span
                className="h-4 w-4 rounded-full border border-border"
                style={{ backgroundColor: option.color }}
              />
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-mono text-muted-foreground">
          {t('outputType')}
        </label>
        <select
          value={value.outputType}
          disabled={disabled}
          onChange={event =>
            onChange({
              ...value,
              outputType: event.target.value as IdPhotoOptionsState['outputType'],
            })
          }
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="image/jpeg">JPEG</option>
          <option value="image/png">PNG</option>
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create the page**

Create `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { formatBytes } from '@/lib/format';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { IdPhotoOptions, type IdPhotoOptionsState } from '@/components/tools/id-photo-options';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { DownloadButton } from '@/components/tools/download-button';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';

const DEFAULT_OPTIONS: IdPhotoOptionsState = {
  preset: 'one_inch',
  backgroundColor: '#438edb',
  outputType: 'image/jpeg',
  crop: { x: 0.5, y: 0.5, scale: 1 },
};

export default function IdPhotoPage() {
  const t = useTranslations('ImageIdPhoto');
  const tShell = useTranslations('ToolShell');
  const tUnits = useTranslations('Common.units');
  const locale = useLocale();
  const tool = getToolByHref('/image/id-photo')!;
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const [file, setFile] = useState<File | null>(null);
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskQuery = useTaskProgress(taskId, {
    onCompleted: async outputFileId => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
        { credentials: 'include' }
      );
      const blob = await response.blob();
      const ext = options.outputType === 'image/png' ? 'png' : 'jpg';
      setResultFile(new File([blob], `id-photo.${ext}`, { type: blob.type }));
      setProcessing(false);
      setTaskId(null);
    },
    onFailed: err => {
      setError(err.message);
      setProcessing(false);
      setTaskId(null);
    },
  });

  const handleDrop = (files: File[]) => {
    if (!files[0]) return;
    setFile(files[0]);
    setResultFile(null);
    setError(null);
  };

  const handleProcess = async () => {
    if (!file) return;
    if (!sessionLoading && !session) {
      router.push(`/login?next=${encodeURIComponent('/image/id-photo')}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setResultFile(null);

    try {
      const uploaded = await uploadFile.mutateAsync(file);
      const task = await createTask.mutateAsync({
        type: 'image_id_photo',
        inputFileIds: [(uploaded as any).id],
        inputConfig: {
          preset: options.preset,
          backgroundColor: options.backgroundColor,
          outputType: options.outputType,
          dpi: 300,
          crop: options.crop,
        },
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const stage = resultFile
    ? 'result'
    : processing
      ? 'processing'
      : file
        ? 'configure'
        : 'upload';

  return (
    <ToolPageShell
      title={t('title')}
      description={t('description')}
      processing={tool.processing}
      retention={tool.retention}
      requiresLogin={tool.requiresLogin}
      recovery={tShell('catalogRecovery')}
      stage={stage}
    >
      <FileDropzone
        accept={{ 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif'] }}
        maxSize={50 * 1024 * 1024}
        onDrop={handleDrop}
        disabled={processing}
        hint={t('dropzoneHint')}
        processingLabel={t('processingLabel')}
      />

      {file && (
        <div className="space-y-6">
          <div className="text-xs font-mono text-muted-foreground">
            {t('selected', {
              filename: file.name,
              size: formatBytes(file.size, tUnits, locale),
            })}
          </div>

          <IdPhotoOptions
            value={options}
            onChange={setOptions}
            disabled={processing}
            t={t}
          />

          <button
            type="button"
            onClick={handleProcess}
            disabled={processing}
            className="h-10 w-full rounded-md bg-foreground text-sm font-mono text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {processing ? t('processing') : t('start')}
          </button>
        </div>
      )}

      {processing && (
        <ProcessingProgress
          value={taskQuery.data?.progress ?? 5}
          label={t('processing')}
        />
      )}

      {error && <FailureRecoveryPanel title={t('failed')} message={error} />}

      {resultFile && (
        <ResultPanel
          title={t('resultTitle')}
          fileName={resultFile.name}
          fileSize={resultFile.size}
          actions={<DownloadButton file={resultFile} />}
        />
      )}
    </ToolPageShell>
  );
}
```

- [ ] **Step 6: Run page tests**

Run:

```bash
bun --cwd apps/web test tool-detail-adoption
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/id-photo/presets.ts apps/web/src/components/tools/id-photo-options.tsx apps/web/src/app/[locale]/\(app\)/image/id-photo/page.tsx apps/web/src/app/[locale]/\(app\)/__tests__/tool-detail-adoption.test.ts
git commit -m "feat(web): add id photo generator page"
```

---

### Task 7: Localization and Task History Labels

**Files:**
- Modify: `apps/web/messages/zh.json`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/src/app/[locale]/(app)/tasks/page.tsx`
- Modify: `apps/web/src/app/[locale]/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add failing task label test**

Export `getTaskTypeCategory` from `apps/web/src/app/[locale]/(app)/tasks/page.tsx`, then create `apps/web/src/app/[locale]/(app)/tasks/__tests__/task-category.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTaskTypeCategory } from '../page';

describe('task category labels', () => {
  it('classifies image_id_photo as an image task', () => {
expect(getTaskTypeCategory('image_id_photo')).toBe('image');
  });
});
```

- [ ] **Step 2: Update task page classification**

Modify `apps/web/src/app/[locale]/(app)/tasks/page.tsx`:

```ts
    case 'image_id_photo':
      return 'image';
```

Add label mapping:

```ts
    image_id_photo: t('typeImageIdPhoto'),
```

- [ ] **Step 3: Add messages**

Add to `apps/web/messages/zh.json`:

```json
"ImageIdPhoto": {
  "title": "证件照生成",
  "description": "自动换底色并裁剪为常用证件照尺寸。",
  "dropzoneHint": "上传清晰的单人正面照片",
  "processingLabel": "服务端高清生成",
  "selected": "{filename} · {size}",
  "preset": "规格",
  "background": "背景色",
  "outputType": "输出格式",
  "start": "生成证件照",
  "processing": "正在生成证件照",
  "failed": "生成失败",
  "resultTitle": "证件照已生成",
  "presets": {
    "oneInch": "一寸",
    "twoInch": "二寸",
    "smallOneInch": "小一寸",
    "passport": "护照照"
  },
  "backgrounds": {
    "blue": "蓝底",
    "white": "白底",
    "red": "红底"
  }
}
```

Add matching English copy to `apps/web/messages/en.json`:

```json
"ImageIdPhoto": {
  "title": "ID Photo Generator",
  "description": "Change the background and crop photos to common ID sizes.",
  "dropzoneHint": "Upload a clear front-facing portrait photo",
  "processingLabel": "Server HD generation",
  "selected": "{filename} · {size}",
  "preset": "Size",
  "background": "Background",
  "outputType": "Output format",
  "start": "Generate ID photo",
  "processing": "Generating ID photo",
  "failed": "Generation failed",
  "resultTitle": "ID photo generated",
  "presets": {
    "oneInch": "One inch",
    "twoInch": "Two inch",
    "smallOneInch": "Small one inch",
    "passport": "Passport"
  },
  "backgrounds": {
    "blue": "Blue",
    "white": "White",
    "red": "Red"
  }
}
```

Add catalog strings under the existing `ToolCatalog.tools` object:

```json
"imageIdPhoto": {
  "title": "证件照生成",
  "description": "自动换底色并裁剪标准尺寸"
}
```

English:

```json
"imageIdPhoto": {
  "title": "ID photo generator",
  "description": "Change backgrounds and crop to standard sizes"
}
```

Add task type labels where existing task messages live:

```json
"typeImageIdPhoto": "证件照生成"
```

English:

```json
"typeImageIdPhoto": "ID photo"
```

Add dashboard task labels under the existing `Dashboard.taskTypes` object:

```json
"image_id_photo": "证件照生成"
```

English:

```json
"image_id_photo": "ID photo"
```

- [ ] **Step 4: Run web tests**

Run:

```bash
bun --cwd apps/web test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/messages/zh.json apps/web/messages/en.json apps/web/src/app/[locale]/\(app\)/tasks/page.tsx apps/web/src/app/[locale]/\(app\)/dashboard/page.tsx
git commit -m "feat(web): localize id photo workflow"
```

---

### Task 8: Build, OpenAPI, and Manual Verification

**Files:**
- Modify: generated files from OpenAPI and Drizzle that changed during Task 2.
- Verify: no additional source files expected

- [ ] **Step 1: Run full static checks**

Run:

```bash
bun run lint
bun --cwd apps/web test
bun test apps/api/src
```

Expected: all pass.

- [ ] **Step 2: Run builds**

Run:

```bash
bun --cwd apps/web build
bun --cwd apps/api build
```

Expected: both builds pass.

- [ ] **Step 3: Run database migration locally**

Run:

```bash
cd packages/db
bunx drizzle-kit migrate
```

Expected: migration applies and `task_type` includes `image_id_photo`.

- [ ] **Step 4: Manual smoke test**

Run the app:

```bash
bun run services:up
bun run dev
```

Manual checks:

- Visit `http://localhost:3000/zh/image`.
- Confirm the catalog shows `证件照生成`.
- Open `/zh/image/id-photo`.
- Upload a portrait image.
- Select one inch and blue background.
- Start generation.
- Confirm a task appears in `/zh/tasks`.
- Confirm the output file downloads as JPG.

- [ ] **Step 5: Commit verification fixes only**

When verification produces source changes, commit them:

```bash
git add <changed-files>
git commit -m "fix: stabilize id photo generator"
```

When verification produces no source changes, leave the branch without an extra commit.

---

## Self-Review

Spec coverage:

- Tool entry and route: Task 5 and Task 6.
- Shared validation: Task 1.
- Task enum, database enum, OpenAPI, api-client: Task 2 and Task 8.
- Backend processing and image queue: Task 3 and Task 4.
- Error codes and recovery: Task 4 and Task 7.
- Localization: Task 7.
- Verification: Task 8.

Type consistency:

- Task type is consistently `image_id_photo`.
- Tool key is consistently `imageIdPhoto`.
- Route is consistently `/image/id-photo`.
- Config shape is consistently `{ preset, backgroundColor, outputType, dpi, crop }`.

Implementation order:

1. Validators.
2. Task type and API contract.
3. Backend rendering services.
4. Processor integration.
5. Web catalog metadata.
6. Web page.
7. Localization and task history.
8. Full verification.
