export * from './schema';
export * from './client';

import { db } from './client';
import {
  accountDeletionQueueScans,
  aiTryOnReferences,
  cleanupObligations,
  files,
  imageGeneratePresets,
  tasks,
  taskSubmissions,
  type AccountDeletionQueueScan,
  type NewAccountDeletionQueueScan,
  type AiTryOnReference,
  type NewAiTryOnReference,
  type CleanupObligation,
  type NewCleanupObligation,
  type File,
  type NewFile,
  type ImageGeneratePreset,
  type NewImageGeneratePreset,
  type Task,
  type NewTask,
  type TaskSubmission,
  type NewTaskSubmission,
} from './schema';

export type {
  AccountDeletionQueueScan,
  NewAccountDeletionQueueScan,
  AiTryOnReference,
  NewAiTryOnReference,
  CleanupObligation,
  NewCleanupObligation,
  File,
  NewFile,
  ImageGeneratePreset,
  NewImageGeneratePreset,
  Task,
  NewTask,
  TaskSubmission,
  NewTaskSubmission,
};
export {
  accountDeletionQueueScans,
  aiTryOnReferences,
  cleanupObligations,
  db,
  files,
  imageGeneratePresets,
  tasks,
  taskSubmissions,
};
