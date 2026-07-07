import { describe, expect, it } from 'vitest';
import { getTaskTypeCategory } from '../page';

describe('task category labels', () => {
  it('classifies image_id_photo as an image task', () => {
    expect(getTaskTypeCategory('image_id_photo')).toBe('image');
  });
});
