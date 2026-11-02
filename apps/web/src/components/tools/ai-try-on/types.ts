import type {
  AiTryOnMode,
  AiTryOnReferenceBinding,
  AiTryOnReferenceRole,
  AiTryOnTaskConfig,
} from '@/hooks/api/types';

export const MAX_TRY_ON_REFERENCES = 4;
export const MIN_TRY_ON_REFERENCES = 2;
export const TRY_ON_PROMPT_MAX_LENGTH = 5000;

export const FIXED_TRY_ON_ROLE_ORDER: readonly AiTryOnReferenceRole[] = [
  'person',
  'garment',
  'pose',
  'style',
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export type TryOnPersonSource = 'upload' | 'library';

export type TryOnResolvedSelection =
  | { role: 'person'; source: 'upload'; fileId: string }
  | { role: 'person'; source: 'library'; assetId: string }
  | { role: 'garment'; source: 'upload'; fileId: string }
  | { role: 'garment'; source: 'library'; assetId: string }
  | { role: 'pose'; source: 'library'; assetId: string }
  | { role: 'style'; source: 'library'; assetId: string };

export type TryOnValidationErrorKey =
  | 'missingPerson'
  | 'missingGarment'
  | 'productRequiresUploadGarment'
  | 'inspirationRequiresLibraryGarment'
  | 'referenceLimitExceeded'
  | 'duplicateRole'
  | 'duplicateUploadFile'
  | 'missingUploadFile'
  | 'invalidUploadFileId'
  | 'invalidLibraryAssetId'
  | 'promptTooLong';

export interface BuildImageTryOnPayloadInput {
  mode: AiTryOnMode;
  person?:
    | { source: 'upload'; fileId: string }
    | { source: 'library'; assetId: string }
    | null;
  garment?:
    | { source: 'upload'; fileId: string }
    | { source: 'library'; assetId: string }
    | null;
  poseAssetId?: string | null;
  styleAssetId?: string | null;
  selections?: TryOnResolvedSelection[];
  promptAddition?: string;
  size?: string;
  quality?: 'auto' | 'standard' | 'high';
  model?: string;
}

export interface ImageTryOnTaskPayload {
  type: 'image_try_on';
  inputFileIds: string[];
  inputConfig: AiTryOnTaskConfig;
}

export type BuildImageTryOnPayloadResult =
  | { ok: true; payload: ImageTryOnTaskPayload }
  | { ok: false; errorKey: TryOnValidationErrorKey };

function collectSelections(
  input: BuildImageTryOnPayloadInput
): TryOnResolvedSelection[] {
  if (input.selections) {
    return input.selections;
  }

  const list: TryOnResolvedSelection[] = [];
  if (input.person) {
    list.push(
      input.person.source === 'upload'
        ? { role: 'person', source: 'upload', fileId: input.person.fileId }
        : { role: 'person', source: 'library', assetId: input.person.assetId }
    );
  }
  if (input.garment) {
    list.push(
      input.garment.source === 'upload'
        ? { role: 'garment', source: 'upload', fileId: input.garment.fileId }
        : { role: 'garment', source: 'library', assetId: input.garment.assetId }
    );
  }
  if (input.poseAssetId) {
    list.push({
      role: 'pose',
      source: 'library',
      assetId: input.poseAssetId,
    });
  }
  if (input.styleAssetId) {
    list.push({
      role: 'style',
      source: 'library',
      assetId: input.styleAssetId,
    });
  }
  return list;
}

/**
 * 按冻结契约组装试衣任务提交载荷：
 * 1. 严格按 person -> garment -> pose -> style 顺序生成 references；
 * 2. inputFileIds 仅保留当前绑定到的上传文件 ID，零未绑定残留，且拒绝同一文件重复绑定；
 * 3. 图库参考只发送 UUID assetId，拒绝任何 URL 或对象存储 key；
 * 4. 总参考数限制在 2–4 张，每个角色最多出现一次。
 */
export function buildImageTryOnTaskPayload(
  input: BuildImageTryOnPayloadInput
): BuildImageTryOnPayloadResult {
  const rawSelections = collectSelections(input);

  if (rawSelections.length > MAX_TRY_ON_REFERENCES) {
    return { ok: false, errorKey: 'referenceLimitExceeded' };
  }

  const seenRoles = new Set<AiTryOnReferenceRole>();
  for (const item of rawSelections) {
    if (seenRoles.has(item.role)) {
      return { ok: false, errorKey: 'duplicateRole' };
    }
    seenRoles.add(item.role);
  }

  const person = rawSelections.find(item => item.role === 'person');
  if (!person) {
    return { ok: false, errorKey: 'missingPerson' };
  }

  const garment = rawSelections.find(item => item.role === 'garment');
  if (!garment) {
    return { ok: false, errorKey: 'missingGarment' };
  }

  if (input.mode === 'product' && garment.source !== 'upload') {
    return { ok: false, errorKey: 'productRequiresUploadGarment' };
  }

  if (input.mode === 'inspiration' && garment.source !== 'library') {
    return { ok: false, errorKey: 'inspirationRequiresLibraryGarment' };
  }

  const orderedSelections = [...rawSelections].sort(
    (a, b) =>
      FIXED_TRY_ON_ROLE_ORDER.indexOf(a.role) -
      FIXED_TRY_ON_ROLE_ORDER.indexOf(b.role)
  );

  const inputFileIds: string[] = [];
  const references: AiTryOnReferenceBinding[] = [];

  for (const item of orderedSelections) {
    if (item.source === 'upload') {
      const fileId = item.fileId.trim();
      if (!fileId) {
        return { ok: false, errorKey: 'missingUploadFile' };
      }
      if (/^https?:\/\//i.test(fileId) || fileId.includes('/')) {
        return { ok: false, errorKey: 'invalidUploadFileId' };
      }
      if (inputFileIds.includes(fileId)) {
        return { ok: false, errorKey: 'duplicateUploadFile' };
      }
      const inputIndex = inputFileIds.length;
      inputFileIds.push(fileId);
      references.push({
        role: item.role,
        source: 'upload',
        inputIndex,
      });
    } else {
      const assetId = item.assetId.trim();
      if (!isUuid(assetId)) {
        return { ok: false, errorKey: 'invalidLibraryAssetId' };
      }
      references.push({
        role: item.role,
        source: 'library',
        assetId,
      });
    }
  }

  const trimmedPrompt = input.promptAddition?.trim() ?? '';
  if (trimmedPrompt.length > TRY_ON_PROMPT_MAX_LENGTH) {
    return { ok: false, errorKey: 'promptTooLong' };
  }

  const inputConfig: AiTryOnTaskConfig = {
    mode: input.mode,
    references,
    ...(trimmedPrompt ? { promptAddition: trimmedPrompt } : {}),
    size: input.size?.trim() || '1024x1024',
    quality: input.quality ?? 'high',
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
  };

  return {
    ok: true,
    payload: {
      type: 'image_try_on',
      inputFileIds,
      inputConfig,
    },
  };
}
