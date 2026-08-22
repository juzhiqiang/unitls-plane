import { describe, expect, it, vi } from 'bun:test';
import { TasksService } from './tasks.service';

function queue(name: string) {
  return {
    name,
    add: vi.fn(),
    getWaitingCount: vi.fn(),
    getActiveCount: vi.fn(),
  };
}

describe('TasksService queue routing', () => {
  function createService() {
    return new TasksService(
      queue('image-queue') as any,
      queue('pdf-queue') as any,
      queue('font-queue') as any,
      queue('ai-queue') as any,
      { getById: vi.fn() } as any,
      { recordTaskJob: vi.fn(), clear: vi.fn(), release: vi.fn() } as any,
      { reconcile: vi.fn() } as any
    );
  }

  it('routes image_id_photo tasks to image queue', () => {
    const service = createService();

    expect((service as any).getQueue('image_id_photo').name).toBe(
      'image-queue'
    );
  });

  it('routes image_generate tasks to ai queue', () => {
    const service = createService();

    expect((service as any).getQueue('image_generate').name).toBe('ai-queue');
  });
});
