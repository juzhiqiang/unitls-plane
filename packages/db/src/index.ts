export * from './schema';
export * from './client';

import { db } from './client';
import {
  accountDeletionQueueScans,
  cleanupObligations,
  files,
  tasks,
  type AccountDeletionQueueScan,
  type NewAccountDeletionQueueScan,
  type CleanupObligation,
  type NewCleanupObligation,
  type File,
  type NewFile,
  type Task,
  type NewTask,
} from './schema';

export type {
  AccountDeletionQueueScan,
  NewAccountDeletionQueueScan,
  CleanupObligation,
  NewCleanupObligation,
  File,
  NewFile,
  Task,
  NewTask,
};
export { accountDeletionQueueScans, cleanupObligations, db, files, tasks };
