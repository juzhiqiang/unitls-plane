import { describe, expect, it } from 'bun:test';
import { getTaskQueueAttempts, getTaskQueueName } from './task-queue';

describe('getTaskQueueName', () => {
  it('maps every task family to its BullMQ queue', () => {
    expect(getTaskQueueName('compress')).toBe('image-queue');
    expect(getTaskQueueName('image_id_photo')).toBe('image-queue');
    expect(getTaskQueueName('pdf_merge')).toBe('pdf-queue');
    expect(getTaskQueueName('pdf_from_document')).toBe('pdf-queue');
    expect(getTaskQueueName('font_convert')).toBe('font-queue');
  });

  it('routes AI image generation to the dedicated ai-queue', () => {
    expect(getTaskQueueName('image_generate')).toBe('ai-queue');
  });
});

describe('getTaskQueueAttempts', () => {
  it('gives AI generation exactly one retry', () => {
    // 每次 attempt 都是一条真实计费的上游请求:一次重试盖住网关抖动,再多就是替用户花钱。
    expect(getTaskQueueAttempts('ai-queue')).toBe(2);
  });

  it('keeps three attempts for local CPU work', () => {
    expect(getTaskQueueAttempts('image-queue')).toBe(3);
    expect(getTaskQueueAttempts('pdf-queue')).toBe(3);
    expect(getTaskQueueAttempts('font-queue')).toBe(3);
  });

  it('falls back for queues outside the task map', () => {
    expect(getTaskQueueAttempts('cleanup-queue')).toBe(3);
  });
});
