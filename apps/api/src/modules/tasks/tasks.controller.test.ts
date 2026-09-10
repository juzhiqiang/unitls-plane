import { beforeEach, expect, it, vi } from 'bun:test';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { TasksController } from './tasks.controller';

// 控制器很薄:只负责把 currentUser 透传给 service,并在未登录时抛 401。
// quota 的数字计算由 tasks.service.test.ts 覆盖,这里只断言转发行为。
const tasksService = {
  getStatuses: vi.fn(),
  listByUser: vi.fn(),
  getImageGenerateQuota: vi.fn(),
  listImageGenerateSessions: vi.fn(),
  listImageGenerateSessionTasks: vi.fn(),
  deleteImageGenerateSession: vi.fn(),
};

const imageGenerationService = {
  listProviders: vi.fn(),
};

function createController() {
  return new TasksController(
    tasksService as never,
    imageGenerationService as never,
    {} as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  tasksService.getStatuses.mockResolvedValue([]);
  tasksService.listByUser.mockResolvedValue({
    tasks: [],
    total: null,
    nextCursor: null,
  });
  tasksService.getImageGenerateQuota.mockResolvedValue({
    limit: 10,
    used: 3,
    remaining: 7,
  });
  imageGenerationService.listProviders.mockReturnValue([
    {
      id: 'default',
      label: '内置生图',
      capabilities: ['generate', 'edit'],
      sizes: ['auto', '1024x1024', '1024x1536', '1536x1024'],
    },
  ]);
});

it('forwards includeTotal=false to the task list service', async () => {
  const user = { id: 'user-1' } as never;

  await createController().list(
    {
      page: 1,
      limit: 20,
      includeTotal: false,
    } as never,
    { user } as never
  );

  expect(tasksService.listByUser).toHaveBeenCalledWith('user-1', {
    page: 1,
    limit: 20,
    status: undefined,
    type: undefined,
    cursor: undefined,
    includeTotal: false,
  });
});

it('returns a deduplicated batch of task statuses', async () => {
  const first = '00000000-0000-4000-8000-000000000001';
  const missing = '00000000-0000-4000-8000-000000000002';
  tasksService.getStatuses.mockResolvedValue([
    { taskId: 'task-1', status: 'processing', progress: 25 },
    { taskId: 'missing', status: 'not_found', progress: 0 },
  ]);

  const result = await createController().getStatuses(
    `${first},${first},${missing}`
  );

  expect(tasksService.getStatuses).toHaveBeenCalledWith([first, missing]);
  expect(result).toEqual([
    { taskId: 'task-1', status: 'processing', progress: 25 },
    { taskId: 'missing', status: 'not_found', progress: 0 },
  ]);
});

it('rejects an empty or oversized batch of task status ids', async () => {
  await expect(createController().getStatuses('')).rejects.toThrow(
    BadRequestException
  );
  const ids = Array.from({ length: 101 }, (_, index) => `task-${index}`);
  await expect(createController().getStatuses(ids.join(','))).rejects.toThrow(
    BadRequestException
  );
  expect(tasksService.getStatuses).not.toHaveBeenCalled();
});

it('rejects malformed ids and repeated query parameters before database work', async () => {
  await expect(createController().getStatuses('not-a-uuid')).rejects.toThrow(
    BadRequestException
  );
  await expect(
    createController().getStatuses(['x', 'y'] as never)
  ).rejects.toThrow(BadRequestException);
  expect(tasksService.getStatuses).not.toHaveBeenCalled();
});

it('returns the quota snapshot for an authenticated user', async () => {
  const user = { id: 'user-1', plan: 'signed_in', role: 'user' } as never;

  const quota = await createController().getImageGenerateQuota(user);

  expect(tasksService.getImageGenerateQuota).toHaveBeenCalledWith(user);
  expect(quota).toEqual({ limit: 10, used: 3, remaining: 7 });
});

it('throws 401 when no user is attached to the request', async () => {
  await expect(
    createController().getImageGenerateQuota(undefined)
  ).rejects.toThrow(UnauthorizedException);

  expect(tasksService.getImageGenerateQuota).not.toHaveBeenCalled();
});

it('propagates the service result unchanged to the response', async () => {
  tasksService.getImageGenerateQuota.mockResolvedValue({
    limit: 100,
    used: 100,
    remaining: 0,
  });
  const user = { id: 'user-1', plan: 'pro_preview', role: 'user' } as never;

  const quota = await createController().getImageGenerateQuota(user);

  expect(quota).toEqual({ limit: 100, used: 100, remaining: 0 });
});

it('returns the configured providers for an authenticated user', async () => {
  const user = { id: 'user-1', plan: 'signed_in', role: 'user' } as never;

  const providers = await createController().listImageGenerateProviders(user);

  expect(providers).toEqual([
    {
      id: 'default',
      label: '内置生图',
      capabilities: ['generate', 'edit'],
      sizes: ['auto', '1024x1024', '1024x1536', '1536x1024'],
    },
  ]);
});

it('throws 401 when listing providers without a user', async () => {
  await expect(
    createController().listImageGenerateProviders(undefined)
  ).rejects.toThrow(UnauthorizedException);

  expect(imageGenerationService.listProviders).not.toHaveBeenCalled();
});

it('returns the session list for an authenticated user', async () => {
  const user = { id: 'user-1', plan: 'signed_in', role: 'user' } as never;
  const sessions = [
    {
      sessionId: '0f0d7ac5-4d3a-4a9e-9a75-2f76db11a001',
      title: '一只戴礼帽的柴犬',
      taskCount: 4,
      createdAt: new Date('2026-09-07T10:00:00Z'),
      updatedAt: new Date('2026-09-07T10:05:00Z'),
    },
  ];
  tasksService.listImageGenerateSessions.mockResolvedValue(sessions);

  const result = await createController().listImageGenerateSessions(user);

  expect(tasksService.listImageGenerateSessions).toHaveBeenCalledWith(user.id);
  expect(result).toEqual(sessions);
});

it('throws 401 when listing sessions without a user', async () => {
  await expect(
    createController().listImageGenerateSessions(undefined)
  ).rejects.toThrow(UnauthorizedException);

  expect(tasksService.listImageGenerateSessions).not.toHaveBeenCalled();
});

it('returns the session tasks for an authenticated user', async () => {
  const user = { id: 'user-1', plan: 'signed_in', role: 'user' } as never;
  const sessionId = '0f0d7ac5-4d3a-4a9e-9a75-2f76db11a001';
  const payload = { tasks: [], total: 0 };
  tasksService.listImageGenerateSessionTasks.mockResolvedValue(payload);

  const result = await createController().listImageGenerateSessionTasks(
    sessionId,
    user
  );

  expect(tasksService.listImageGenerateSessionTasks).toHaveBeenCalledWith(
    user.id,
    sessionId
  );
  expect(result).toEqual(payload);
});

it('throws 401 when listing session tasks without a user', async () => {
  await expect(
    createController().listImageGenerateSessionTasks(
      '0f0d7ac5-4d3a-4a9e-9a75-2f76db11a001',
      undefined
    )
  ).rejects.toThrow(UnauthorizedException);

  expect(tasksService.listImageGenerateSessionTasks).not.toHaveBeenCalled();
});

it('deletes a session for an authenticated user', async () => {
  const user = { id: 'user-1', plan: 'signed_in', role: 'user' } as never;
  const sessionId = '0f0d7ac5-4d3a-4a9e-9a75-2f76db11a001';
  tasksService.deleteImageGenerateSession.mockResolvedValue({
    deletedTasks: 3,
  });

  const result = await createController().deleteImageGenerateSession(
    sessionId,
    user
  );

  expect(tasksService.deleteImageGenerateSession).toHaveBeenCalledWith(
    user.id,
    sessionId
  );
  expect(result).toEqual({ deletedTasks: 3 });
});

it('throws 401 when deleting a session without a user', async () => {
  await expect(
    createController().deleteImageGenerateSession(
      '0f0d7ac5-4d3a-4a9e-9a75-2f76db11a001',
      undefined
    )
  ).rejects.toThrow(UnauthorizedException);

  expect(tasksService.deleteImageGenerateSession).not.toHaveBeenCalled();
});
