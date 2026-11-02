import { describe, expect, it } from 'vitest';
import {
  buildImageTryOnTaskPayload,
  isUuid,
  MAX_TRY_ON_REFERENCES,
  TRY_ON_PROMPT_MAX_LENGTH,
} from '@/components/tools/ai-try-on';

const PERSON_ASSET_ID = '00000000-0000-4000-8000-000000000001';
const GARMENT_ASSET_ID = '00000000-0000-4000-8000-000000000002';
const POSE_ASSET_ID = '00000000-0000-4000-8000-000000000003';
const STYLE_ASSET_ID = '00000000-0000-4000-8000-000000000004';

describe('buildImageTryOnTaskPayload', () => {
  it('validates UUID format and rejects URLs or storage keys', () => {
    expect(isUuid(PERSON_ASSET_ID)).toBe(true);
    expect(isUuid('https://cdn.example.test/person.png')).toBe(false);
    expect(isUuid('presets/person.png')).toBe(false);
    expect(isUuid('')).toBe(false);
  });

  it('maps inputFileIds and 0-based inputIndex in fixed role order for product mode with two uploads', () => {
    const result = buildImageTryOnTaskPayload({
      mode: 'product',
      person: { source: 'upload', fileId: 'file-person-1' },
      garment: { source: 'upload', fileId: 'file-garment-2' },
      poseAssetId: POSE_ASSET_ID,
      styleAssetId: STYLE_ASSET_ID,
      promptAddition: '  minimalist white studio  ',
      size: '1024x1536',
      quality: 'high',
      model: 'gpt-image-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload).toEqual({
      type: 'image_try_on',
      inputFileIds: ['file-person-1', 'file-garment-2'],
      inputConfig: {
        mode: 'product',
        references: [
          { role: 'person', source: 'upload', inputIndex: 0 },
          { role: 'garment', source: 'upload', inputIndex: 1 },
          { role: 'pose', source: 'library', assetId: POSE_ASSET_ID },
          { role: 'style', source: 'library', assetId: STYLE_ASSET_ID },
        ],
        promptAddition: 'minimalist white studio',
        size: '1024x1536',
        quality: 'high',
        model: 'gpt-image-1',
      },
    });
  });

  it('assigns inputIndex 0 to uploaded garment when person comes from the library', () => {
    const result = buildImageTryOnTaskPayload({
      mode: 'product',
      person: { source: 'library', assetId: PERSON_ASSET_ID },
      garment: { source: 'upload', fileId: 'file-garment-only' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.inputFileIds).toEqual(['file-garment-only']);
    expect(result.payload.inputConfig.references).toEqual([
      { role: 'person', source: 'library', assetId: PERSON_ASSET_ID },
      { role: 'garment', source: 'upload', inputIndex: 0 },
    ]);
  });

  it('builds inspiration mode payload with empty inputFileIds when all references are from the library', () => {
    const result = buildImageTryOnTaskPayload({
      mode: 'inspiration',
      person: { source: 'library', assetId: PERSON_ASSET_ID },
      garment: { source: 'library', assetId: GARMENT_ASSET_ID },
      poseAssetId: POSE_ASSET_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.inputFileIds).toEqual([]);
    expect(result.payload.inputConfig.references).toEqual([
      { role: 'person', source: 'library', assetId: PERSON_ASSET_ID },
      { role: 'garment', source: 'library', assetId: GARMENT_ASSET_ID },
      { role: 'pose', source: 'library', assetId: POSE_ASSET_ID },
    ]);
  });

  it('sorts out-of-order selections into person -> garment -> pose -> style order', () => {
    const result = buildImageTryOnTaskPayload({
      mode: 'product',
      selections: [
        { role: 'style', source: 'library', assetId: STYLE_ASSET_ID },
        { role: 'garment', source: 'upload', fileId: 'file-garment' },
        { role: 'pose', source: 'library', assetId: POSE_ASSET_ID },
        { role: 'person', source: 'upload', fileId: 'file-person' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.inputFileIds).toEqual([
      'file-person',
      'file-garment',
    ]);
    expect(
      result.payload.inputConfig.references.map(item => item.role)
    ).toEqual(['person', 'garment', 'pose', 'style']);
    expect(result.payload.inputConfig.references[0]).toEqual({
      role: 'person',
      source: 'upload',
      inputIndex: 0,
    });
    expect(result.payload.inputConfig.references[1]).toEqual({
      role: 'garment',
      source: 'upload',
      inputIndex: 1,
    });
  });

  it('enforces the four-reference ceiling and rejects duplicate roles', () => {
    const tooMany = buildImageTryOnTaskPayload({
      mode: 'product',
      selections: [
        { role: 'person', source: 'upload', fileId: 'file-1' },
        { role: 'garment', source: 'upload', fileId: 'file-2' },
        { role: 'pose', source: 'library', assetId: POSE_ASSET_ID },
        { role: 'style', source: 'library', assetId: STYLE_ASSET_ID },
        { role: 'person', source: 'library', assetId: PERSON_ASSET_ID },
      ],
    });
    expect(MAX_TRY_ON_REFERENCES).toBe(4);
    expect(tooMany).toEqual({
      ok: false,
      errorKey: 'referenceLimitExceeded',
    });

    const duplicateRole = buildImageTryOnTaskPayload({
      mode: 'product',
      selections: [
        { role: 'person', source: 'upload', fileId: 'file-1' },
        { role: 'person', source: 'library', assetId: PERSON_ASSET_ID },
        { role: 'garment', source: 'upload', fileId: 'file-2' },
      ],
    });
    expect(duplicateRole).toEqual({
      ok: false,
      errorKey: 'duplicateRole',
    });
  });

  it('rejects missing person, missing garment, and mode/source mismatches', () => {
    expect(
      buildImageTryOnTaskPayload({
        mode: 'product',
        person: null,
        garment: { source: 'upload', fileId: 'file-1' },
      })
    ).toEqual({ ok: false, errorKey: 'missingPerson' });

    expect(
      buildImageTryOnTaskPayload({
        mode: 'product',
        person: { source: 'upload', fileId: 'file-1' },
        garment: null,
      })
    ).toEqual({ ok: false, errorKey: 'missingGarment' });

    expect(
      buildImageTryOnTaskPayload({
        mode: 'product',
        person: { source: 'library', assetId: PERSON_ASSET_ID },
        garment: { source: 'library', assetId: GARMENT_ASSET_ID },
      })
    ).toEqual({ ok: false, errorKey: 'productRequiresUploadGarment' });

    expect(
      buildImageTryOnTaskPayload({
        mode: 'inspiration',
        person: { source: 'library', assetId: PERSON_ASSET_ID },
        garment: { source: 'upload', fileId: 'file-1' },
      })
    ).toEqual({ ok: false, errorKey: 'inspirationRequiresLibraryGarment' });
  });

  it('rejects reused upload file IDs and non-UUID library asset IDs', () => {
    expect(
      buildImageTryOnTaskPayload({
        mode: 'product',
        person: { source: 'upload', fileId: 'same-file-id' },
        garment: { source: 'upload', fileId: 'same-file-id' },
      })
    ).toEqual({ ok: false, errorKey: 'duplicateUploadFile' });

    expect(
      buildImageTryOnTaskPayload({
        mode: 'inspiration',
        person: {
          source: 'library',
          assetId: 'https://cdn.example.test/person.png',
        },
        garment: { source: 'library', assetId: GARMENT_ASSET_ID },
      })
    ).toEqual({ ok: false, errorKey: 'invalidLibraryAssetId' });
  });

  it('rejects prompt additions exceeding the 5000-character limit', () => {
    expect(
      buildImageTryOnTaskPayload({
        mode: 'inspiration',
        person: { source: 'library', assetId: PERSON_ASSET_ID },
        garment: { source: 'library', assetId: GARMENT_ASSET_ID },
        promptAddition: 'a'.repeat(TRY_ON_PROMPT_MAX_LENGTH + 1),
      })
    ).toEqual({ ok: false, errorKey: 'promptTooLong' });
  });
});
