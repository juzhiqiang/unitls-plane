import { beforeEach, expect, it, vi } from 'bun:test';

const { AccountService } = await import('./account.service');

const events: string[] = [];
const profile = {
  id: 'user-1',
  email: ' Owner@Example.com ',
  deletionStartedAt: null,
};
const snapshot = {
  profile,
  files: [
    { id: 'file-1', storageKey: 'users/user-1/file-1' },
    { id: 'file-2', storageKey: 'users/user-1/file-2' },
  ],
  tasks: [{ id: 'task-1', type: 'pdf_merge' }],
};
const repository = {
  getSummary: vi.fn(),
  getDeletionProfile: vi.fn(async () => {
    events.push('profile');
    return profile;
  }),
  markDeletionStarted: vi.fn(async () => {
    events.push('markDeletionStarted');
    return { ...profile, deletionStartedAt: new Date() };
  }),
  getDeletionSnapshot: vi.fn(async () => {
    events.push('snapshot');
    return snapshot;
  }),
  deleteSessions: vi.fn(async () => {
    events.push('deleteSessions');
  }),
  deleteAccountRecords: vi.fn(async () => {
    events.push('deleteAccountRecords');
  }),
};
const minio = {
  delete: vi.fn(async (storageKey: string) => {
    events.push(`deleteObject:${storageKey}`);
  }),
};
const taskQueues = {
  assertNoActiveAndRemove: vi.fn(async () => {
    events.push('removeTaskJobs');
  }),
};

function createService() {
  return new AccountService(
    repository as never,
    minio as never,
    taskQueues as never
  );
}

beforeEach(() => {
  events.length = 0;
  vi.clearAllMocks();
  repository.getDeletionProfile.mockImplementation(async () => {
    events.push('profile');
    return profile;
  });
  repository.markDeletionStarted.mockImplementation(async () => {
    events.push('markDeletionStarted');
    return { ...profile, deletionStartedAt: new Date() };
  });
  repository.getDeletionSnapshot.mockImplementation(async () => {
    events.push('snapshot');
    return snapshot;
  });
  repository.deleteSessions.mockImplementation(async () => {
    events.push('deleteSessions');
  });
  repository.deleteAccountRecords.mockImplementation(async () => {
    events.push('deleteAccountRecords');
  });
  minio.delete.mockImplementation(async storageKey => {
    events.push(`deleteObject:${storageKey}`);
  });
  taskQueues.assertNoActiveAndRemove.mockImplementation(async () => {
    events.push('removeTaskJobs');
  });
});

it('returns full counts instead of deriving them from recent rows', async () => {
  const summary = {
    activeTaskCount: 7,
    failedTaskCount: 4,
    activeFileCount: 23,
    activeFileBytes: 123456,
    recentTasks: [{ id: 'task-1', status: 'completed' }],
    recentFiles: [{ id: 'file-1', filename: 'result.pdf' }],
  };
  repository.getSummary.mockResolvedValue(summary);

  await expect(createService().getSummary('user-1')).resolves.toBe(summary);
});

it('confirms the email before persisting deletion state', async () => {
  await expect(
    createService().deleteAccount('user-1', ' other@example.com ')
  ).rejects.toThrow('Confirmation email does not match');

  expect(events).toEqual(['profile']);
  expect(repository.markDeletionStarted).not.toHaveBeenCalled();
  expect(taskQueues.assertNoActiveAndRemove).not.toHaveBeenCalled();
  expect(minio.delete).not.toHaveBeenCalled();
});

it('keeps deletion state and sessions when object deletion fails', async () => {
  minio.delete.mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(
    createService().deleteAccount('user-1', 'owner@example.com')
  ).rejects.toThrow('Account deletion is incomplete');

  expect(repository.markDeletionStarted).toHaveBeenCalledWith('user-1');
  expect(repository.deleteSessions).not.toHaveBeenCalled();
  expect(repository.deleteAccountRecords).not.toHaveBeenCalled();
  expect(events).toEqual([
    'profile',
    'markDeletionStarted',
    'snapshot',
    'removeTaskJobs',
  ]);
});

it('stops before object deletion when any task job is active', async () => {
  taskQueues.assertNoActiveAndRemove.mockRejectedValueOnce(
    new Error('Account has active tasks')
  );

  await expect(
    createService().deleteAccount('user-1', 'owner@example.com')
  ).rejects.toThrow('Account has active tasks');

  expect(repository.markDeletionStarted).toHaveBeenCalledWith('user-1');
  expect(minio.delete).not.toHaveBeenCalled();
  expect(repository.deleteSessions).not.toHaveBeenCalled();
  expect(repository.deleteAccountRecords).not.toHaveBeenCalled();
});

it('stops before object deletion while the bounded legacy scan is incomplete', async () => {
  taskQueues.assertNoActiveAndRemove.mockRejectedValueOnce(
    new Error('Account task scan is incomplete')
  );

  await expect(
    createService().deleteAccount('user-1', 'owner@example.com')
  ).rejects.toThrow('Account task scan is incomplete');

  expect(minio.delete).not.toHaveBeenCalled();
  expect(repository.deleteAccountRecords).not.toHaveBeenCalled();
});

it('removes jobs and objects before the final records transaction', async () => {
  await createService().deleteAccount('user-1', ' OWNER@example.COM ');

  expect(taskQueues.assertNoActiveAndRemove).toHaveBeenCalledWith(
    'user-1',
    snapshot.tasks
  );
  expect(repository.deleteSessions).not.toHaveBeenCalled();
  expect(events).toEqual([
    'profile',
    'markDeletionStarted',
    'snapshot',
    'removeTaskJobs',
    'deleteObject:users/user-1/file-1',
    'deleteObject:users/user-1/file-2',
    'deleteAccountRecords',
  ]);
});

it('retries idempotently after an object failure without revoking sessions', async () => {
  minio.delete
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValue(undefined);
  const service = createService();

  await expect(
    service.deleteAccount('user-1', 'owner@example.com')
  ).rejects.toThrow('Account deletion is incomplete');
  await expect(
    service.deleteAccount('user-1', 'owner@example.com')
  ).resolves.toBeUndefined();

  expect(repository.markDeletionStarted).toHaveBeenCalledTimes(2);
  expect(repository.deleteSessions).not.toHaveBeenCalled();
  expect(repository.deleteAccountRecords).toHaveBeenCalledTimes(1);
});
