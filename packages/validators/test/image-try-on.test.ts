import { describe, expect, it } from 'bun:test';
import { createTaskSchema, TASK_TYPES } from '../src/tasks';

const tryOnValidators = await import('../src/image-try-on').catch(() => null);
const imageTryOnTaskConfigSchema = tryOnValidators?.imageTryOnTaskConfigSchema;
const imageGenerationTaskTypes = (await import('../src/tasks'))
  .IMAGE_GENERATION_TASK_TYPES;

const personUpload = {
  role: 'person',
  source: 'upload',
  inputIndex: 0,
} as const;
const productUpload = {
  role: 'garment',
  source: 'upload',
  inputIndex: 1,
} as const;
const personModel = {
  role: 'person',
  source: 'library',
  assetId: '00000000-0000-4000-8000-000000000001',
} as const;
const inspirationGarment = {
  role: 'garment',
  source: 'library',
  assetId: '00000000-0000-4000-8000-000000000002',
} as const;

describe('imageTryOnTaskConfigSchema', () => {
  it('registers image_try_on as a task type', () => {
    expect(TASK_TYPES).toContain('image_try_on');
    expect(imageGenerationTaskTypes).toEqual([
      'image_generate',
      'image_try_on',
    ]);
  });

  it('allows library-only inspiration tasks without uploaded file ids', () => {
    expect(
      createTaskSchema.safeParse({
        type: 'image_try_on',
        inputFileIds: [],
        inputConfig: {},
      }).success
    ).toBe(true);
  });

  it('rejects duplicate uploaded file ids on try-on tasks', () => {
    const duplicatedFileId = '00000000-0000-4000-8000-000000000003';
    expect(
      createTaskSchema.safeParse({
        type: 'image_try_on',
        inputFileIds: [duplicatedFileId, duplicatedFileId],
        inputConfig: {},
      }).success
    ).toBe(false);
  });

  it('keeps text-to-image tasks valid without uploaded file ids', () => {
    expect(
      createTaskSchema.safeParse({
        type: 'image_generate',
        inputFileIds: [],
        inputConfig: {},
      }).success
    ).toBe(true);
  });

  it('still requires uploaded files for other task types', () => {
    expect(
      createTaskSchema.safeParse({
        type: 'pdf_merge',
        inputFileIds: [],
        inputConfig: {},
      }).success
    ).toBe(false);
  });

  it('exports the try-on task config schema', () => {
    expect(imageTryOnTaskConfigSchema).toBeDefined();
  });

  if (imageTryOnTaskConfigSchema) {
    it('accepts a product try-on with uploaded person and garment images', () => {
      const result = imageTryOnTaskConfigSchema.parse({
        mode: 'product',
        references: [personUpload, productUpload],
        inputFileCount: 2,
      });

      expect(result.size).toBe('1024x1024');
      expect(result.quality).toBe('high');
    });

    it('accepts inspiration mode with a curated person and garment', () => {
      expect(
        imageTryOnTaskConfigSchema.safeParse({
          mode: 'inspiration',
          references: [personModel, inspirationGarment],
          inputFileCount: 0,
        }).success
      ).toBe(true);
    });

    it('requires an uploaded garment for product mode', () => {
      expect(
        imageTryOnTaskConfigSchema.safeParse({
          mode: 'product',
          references: [personModel, inspirationGarment],
          inputFileCount: 0,
        }).success
      ).toBe(false);
    });

    it('requires a curated garment for inspiration mode', () => {
      expect(
        imageTryOnTaskConfigSchema.safeParse({
          mode: 'inspiration',
          references: [personUpload, productUpload],
          inputFileCount: 2,
        }).success
      ).toBe(false);
    });

    it('rejects duplicate roles and reused upload indexes', () => {
      const duplicateRole = imageTryOnTaskConfigSchema.safeParse({
        mode: 'product',
        references: [
          personUpload,
          { role: 'person', source: 'library', assetId: personModel.assetId },
          productUpload,
        ],
        inputFileCount: 2,
      });
      const reusedIndex = imageTryOnTaskConfigSchema.safeParse({
        mode: 'product',
        references: [
          personUpload,
          { role: 'garment', source: 'upload', inputIndex: 0 },
        ],
        inputFileCount: 1,
      });

      expect(duplicateRole.success).toBe(false);
      expect(reusedIndex.success).toBe(false);
    });

    it('rejects an unbound upload or an out-of-range upload index', () => {
      const unbound = imageTryOnTaskConfigSchema.safeParse({
        mode: 'product',
        references: [personUpload, productUpload],
        inputFileCount: 3,
      });
      const outOfRange = imageTryOnTaskConfigSchema.safeParse({
        mode: 'product',
        references: [
          personUpload,
          { role: 'garment', source: 'upload', inputIndex: 2 },
        ],
        inputFileCount: 2,
      });

      expect(unbound.success).toBe(false);
      expect(outOfRange.success).toBe(false);
    });

    it('allows at most four references and rejects user-supplied storage URLs', () => {
      const tooMany = imageTryOnTaskConfigSchema.safeParse({
        mode: 'product',
        references: [
          personUpload,
          productUpload,
          { role: 'pose', source: 'library', assetId: personModel.assetId },
          {
            role: 'style',
            source: 'library',
            assetId: inspirationGarment.assetId,
          },
          { role: 'person', source: 'library', assetId: personModel.assetId },
        ],
        inputFileCount: 2,
      });
      const storageUrl = imageTryOnTaskConfigSchema.safeParse({
        mode: 'inspiration',
        references: [
          {
            role: 'person',
            source: 'library',
            assetId: 'https://example.test/a.png',
          },
          inspirationGarment,
        ],
        inputFileCount: 0,
      });

      expect(tooMany.success).toBe(false);
      expect(storageUrl.success).toBe(false);
    });

    it('caps prompt additions at the existing image prompt limit', () => {
      expect(
        imageTryOnTaskConfigSchema.safeParse({
          mode: 'inspiration',
          references: [personModel, inspirationGarment],
          inputFileCount: 0,
          promptAddition: 'x'.repeat(5001),
        }).success
      ).toBe(false);
    });
  }
});
