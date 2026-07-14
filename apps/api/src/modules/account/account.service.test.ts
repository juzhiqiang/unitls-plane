import { beforeEach, expect, it, vi } from 'bun:test';
import { AccountService } from './account.service';

const repository = {
  getSummary: vi.fn(),
  getDeletionSnapshot: vi.fn(),
  deleteAccountRecords: vi.fn(),
};
const minio = { delete: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  minio.delete.mockResolvedValue(undefined);
});

function createService(options?: {
  profile: { id: string; email: string };
  files?: { id: string; storageKey: string }[];
}) {
  if (options)
    repository.getDeletionSnapshot.mockResolvedValue({
      profile: options.profile,
      files: options.files ?? [],
    });
  return new AccountService(repository as never, minio as never);
}

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
  const service = createService();

  await expect(service.getSummary('user-1')).resolves.toBe(summary);
  expect(repository.getSummary).toHaveBeenCalledWith('user-1');
});

it('rejects confirmation for another account after normalizing both emails', async () => {
  const service = createService({
    profile: { id: 'user-1', email: ' Owner@Example.com ' },
  });

  await expect(
    service.deleteAccount('user-1', ' OTHER@example.com ')
  ).rejects.toThrow('Confirmation email does not match');
  expect(repository.deleteAccountRecords).not.toHaveBeenCalled();
  expect(minio.delete).not.toHaveBeenCalled();
});

it('does not delete database records when an account object cannot be deleted', async () => {
  const service = createService({
    profile: { id: 'user-1', email: 'owner@example.com' },
    files: [{ id: 'file-1', storageKey: 'users/user-1/file-1' }],
  });
  minio.delete.mockRejectedValue(new Error('storage unavailable'));

  await expect(
    service.deleteAccount('user-1', 'owner@example.com')
  ).rejects.toThrow('Account deletion is incomplete');
  expect(minio.delete).toHaveBeenCalledTimes(1);
  expect(repository.deleteAccountRecords).not.toHaveBeenCalled();
});

it('deletes database records only after every account object is deleted', async () => {
  const service = createService({
    profile: { id: 'user-1', email: ' Owner@Example.com ' },
    files: [
      { id: 'file-1', storageKey: 'users/user-1/file-1' },
      { id: 'file-2', storageKey: 'users/user-1/file-2' },
    ],
  });

  await service.deleteAccount('user-1', ' OWNER@example.COM ');

  expect(minio.delete).toHaveBeenCalledTimes(2);
  expect(minio.delete).toHaveBeenNthCalledWith(1, 'users/user-1/file-1');
  expect(minio.delete).toHaveBeenNthCalledWith(2, 'users/user-1/file-2');
  expect(repository.deleteAccountRecords).toHaveBeenCalledTimes(1);
  expect(repository.deleteAccountRecords).toHaveBeenCalledWith('user-1');
  expect(minio.delete.mock.invocationCallOrder[1]).toBeLessThan(
    repository.deleteAccountRecords.mock.invocationCallOrder[0]
  );
});

it('retries every object after a partial failure and deletes records once', async () => {
  const service = createService({
    profile: { id: 'user-1', email: 'owner@example.com' },
    files: [
      { id: 'file-1', storageKey: 'users/user-1/file-1' },
      { id: 'file-2', storageKey: 'users/user-1/file-2' },
    ],
  });
  minio.delete
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValue(undefined);

  await expect(
    service.deleteAccount('user-1', 'owner@example.com')
  ).rejects.toThrow('Account deletion is incomplete');
  expect(repository.deleteAccountRecords).not.toHaveBeenCalled();

  await expect(
    service.deleteAccount('user-1', ' OWNER@EXAMPLE.COM ')
  ).resolves.toBeUndefined();

  expect(minio.delete).toHaveBeenCalledTimes(4);
  expect(minio.delete).toHaveBeenNthCalledWith(3, 'users/user-1/file-1');
  expect(minio.delete).toHaveBeenNthCalledWith(4, 'users/user-1/file-2');
  expect(repository.deleteAccountRecords).toHaveBeenCalledTimes(1);
  expect(repository.deleteAccountRecords).toHaveBeenCalledWith('user-1');
});
