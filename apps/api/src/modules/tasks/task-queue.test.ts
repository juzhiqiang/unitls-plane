import { describe, expect, it } from 'bun:test';
import { getTaskQueueName } from './task-queue';

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
