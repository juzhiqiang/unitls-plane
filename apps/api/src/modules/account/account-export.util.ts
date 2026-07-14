import { posix } from 'node:path';
import type {
  AccountExportFile,
  AccountExportTask,
} from './account.repository';

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_CONFIG_KEYS = [
  'password',
  'token',
  'secret',
  'authorization',
  'apikey',
];

export function buildExportFilename(date: Date): string {
  const iso = date.toISOString();
  const day = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `utils-plane-export-${day}-${time}.zip`;
}

export function createArchivePath(
  filename: string,
  fileId: string,
  usedPaths: Set<string>
): string {
  const idPrefix = fileId.startsWith('file-')
    ? fileId.slice(0, 9)
    : fileId.slice(0, 8);
  const normalized = filename.replaceAll('\\', '/');
  const cleanName = posix
    .basename(normalized)
    .split('')
    .filter(character => {
      const codePoint = character.charCodeAt(0);
      return codePoint > 31 && (codePoint < 127 || codePoint > 159);
    })
    .join('')
    .trim();
  const safeName =
    cleanName && cleanName !== '.' && cleanName !== '..'
      ? cleanName
      : `file-${idPrefix}`;
  let exportPath = `files/${safeName}`;

  if (usedPaths.has(exportPath)) {
    const extension = posix.extname(safeName);
    const stem = safeName.slice(0, safeName.length - extension.length);
    const disambiguated = `${stem}-${idPrefix}${extension}`;
    exportPath = `files/${disambiguated}`;
    for (let suffix = 2; usedPaths.has(exportPath); suffix++)
      exportPath = `files/${stem}-${idPrefix}-${suffix}${extension}`;
  }

  usedPaths.add(exportPath);
  return exportPath;
}

export function createManifestEntry(
  file: AccountExportFile,
  exportPath: string
) {
  return {
    id: file.id,
    filename: file.filename,
    originalSize: file.originalSize,
    mimeType: file.mimeType,
    createdAt: file.createdAt,
    deletedAt: file.deletedAt,
    status: file.deletedAt ? ('trashed' as const) : ('active' as const),
    exportPath,
  };
}

function redactSensitiveConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveConfig);
  if (!value || typeof value !== 'object' || value instanceof Date)
    return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
      const isSensitive = SENSITIVE_CONFIG_KEYS.some(sensitiveKey =>
        normalizedKey.includes(sensitiveKey)
      );
      return [
        key,
        isSensitive ? REDACTED_VALUE : redactSensitiveConfig(nestedValue),
      ];
    })
  );
}

export function createExportTask(task: AccountExportTask): AccountExportTask {
  return {
    id: task.id,
    userId: task.userId,
    type: task.type,
    status: task.status,
    inputFileIds: task.inputFileIds,
    inputConfig: redactSensitiveConfig(task.inputConfig),
    outputFileId: task.outputFileId,
    progress: task.progress,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    retryCount: task.retryCount,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  };
}
