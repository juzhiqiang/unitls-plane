import { describe, it, expect } from 'vitest';
import { shouldProcessLocally } from '../image-client';

describe('shouldProcessLocally', () => {
  it('returns true for files under 5MB', () => {
    const file = new File(['x'.repeat(1024)], 'small.jpg', { type: 'image/jpeg' });
    expect(shouldProcessLocally(file)).toBe(true);
  });

  it('returns false for files at exactly 5MB', () => {
    const file = new File([new ArrayBuffer(5 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    expect(shouldProcessLocally(file)).toBe(false);
  });

  it('returns false for files over 5MB', () => {
    const file = new File([new ArrayBuffer(6 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' });
    expect(shouldProcessLocally(file)).toBe(false);
  });

  it('returns true for file just under 5MB', () => {
    const file = new File([new ArrayBuffer(5 * 1024 * 1024 - 1)], 'edge.jpg', { type: 'image/jpeg' });
    expect(shouldProcessLocally(file)).toBe(true);
  });
});
