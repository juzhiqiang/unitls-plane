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
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_INVALID_CHARACTERS = /[<>:"/\\|?*]/g;
const MAX_ARCHIVE_FILENAME_LENGTH = 200;
const MAX_ARCHIVE_EXTENSION_LENGTH = 20;

export interface ArchivePathRegistry {
  has(path: string): boolean;
  add(path: string): unknown;
}

export function buildExportFilename(date: Date): string {
  const iso = date.toISOString();
  const day = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `utils-plane-export-${day}-${time}.zip`;
}

function takeCodePoints(value: string, count: number): string {
  return Array.from(value).slice(0, count).join('');
}

function splitLimitedExtension(filename: string) {
  const rawExtension = posix.extname(filename);
  const extension = takeCodePoints(rawExtension, MAX_ARCHIVE_EXTENSION_LENGTH);
  return {
    stem: filename.slice(0, filename.length - rawExtension.length),
    extension,
  };
}

function limitArchiveFilename(filename: string): string {
  const { stem, extension } = splitLimitedExtension(filename);
  const availableStemLength =
    MAX_ARCHIVE_FILENAME_LENGTH - Array.from(extension).length;
  return `${takeCodePoints(stem, availableStemLength)}${extension}`;
}

function appendArchiveFilenameSuffix(filename: string, suffix: string): string {
  const { stem, extension } = splitLimitedExtension(filename);
  const availableStemLength = Math.max(
    1,
    MAX_ARCHIVE_FILENAME_LENGTH -
      Array.from(suffix).length -
      Array.from(extension).length
  );
  return `${takeCodePoints(stem, availableStemLength)}${suffix}${extension}`;
}

function createArchivePathCollisionKey(path: string): string {
  return path.normalize('NFKC').toLowerCase();
}

export function createArchivePath(
  filename: string,
  fileId: string,
  usedPaths: ArchivePathRegistry
): string {
  const idPrefix = fileId.startsWith('file-')
    ? fileId.slice(0, 9)
    : fileId.slice(0, 8);
  const normalized = filename.replaceAll('\\', '/');
  const cleanName = posix
    .basename(normalized)
    .normalize('NFC')
    .split('')
    .filter(character => {
      const codePoint = character.charCodeAt(0);
      return codePoint > 31 && (codePoint < 127 || codePoint > 159);
    })
    .join('')
    .replaceAll(WINDOWS_INVALID_CHARACTERS, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  const fallbackName = `file-${idPrefix}`;
  const usableName =
    cleanName && cleanName !== '.' && cleanName !== '..'
      ? cleanName
      : fallbackName;
  const safeName = limitArchiveFilename(
    WINDOWS_RESERVED_NAME.test(usableName) ? `_${usableName}` : usableName
  );
  let exportPath = `files/${safeName}`;
  let collisionKey = createArchivePathCollisionKey(exportPath);

  if (usedPaths.has(collisionKey)) {
    const disambiguated = appendArchiveFilenameSuffix(safeName, `-${idPrefix}`);
    exportPath = `files/${disambiguated}`;
    collisionKey = createArchivePathCollisionKey(exportPath);
    for (let suffix = 2; usedPaths.has(collisionKey); suffix++) {
      exportPath = `files/${appendArchiveFilenameSuffix(
        safeName,
        `-${idPrefix}-${suffix}`
      )}`;
      collisionKey = createArchivePathCollisionKey(exportPath);
    }
  }

  usedPaths.add(collisionKey);
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
