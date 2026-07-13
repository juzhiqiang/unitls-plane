export * from './schema';
export * from './client';

import { db } from './client';
import {
  files,
  tasks,
  type File,
  type NewFile,
  type Task,
  type NewTask,
} from './schema';

export type { File, NewFile, Task, NewTask };
export { db, files, tasks };
