import { beforeEach, expect, it, vi } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { TasksController } from './tasks.controller';

// 控制器很薄:只负责把 currentUser 透传给 service,并在未登录时抛 401。
// quota 的数字计算由 tasks.service.test.ts 覆盖,这里只断言转发行为。
const tasksService = {
  getImageGenerateQuota: vi.fn(),
  listImageGenerateSessions: vi.fn(),
  listImageGenerateSessionTasks: vi.fn(),
};

const imageGenerationService = {
  listProviders: vi.fn(),
};

function createController() {
  return new TasksController(
    tasksService as never,
    imageGenerationService as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
