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

function createService(options?: { profile: { id: string; email: string } }) {
  if (options)
    repository.getDeletionSnapshot.mockResolvedValue({
      profile: options.profile,
      files: [],
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
