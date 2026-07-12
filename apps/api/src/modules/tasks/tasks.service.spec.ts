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
  it('routes image_id_photo tasks to image queue', () => {
    const service = new TasksService(
      queue('image-queue') as any,
      queue('pdf-queue') as any,
      queue('font-queue') as any,
      { getById: vi.fn() } as any
    );

    expect((service as any).getQueue('image_id_photo').name).toBe(
      'image-queue'
    );
  });
});
