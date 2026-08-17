import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useObjectUrl } from '../use-object-url';

describe('useObjectUrl', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:test-url');
    revokeObjectURL = vi.fn();
    // jsdom 未实现 URL.createObjectURL,统一 stub
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no file is provided', () => {
    const { result } = renderHook(() => useObjectUrl(null));
    expect(result.current).toBeNull();
  });

  it('creates an object URL for the given file', () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const { result } = renderHook(() => useObjectUrl(file));
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(result.current).toBe('blob:test-url');
  });

  it('revokes the previous URL when the file changes', () => {
    const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
    createObjectURL
      .mockReturnValueOnce('blob:url-a')
      .mockReturnValueOnce('blob:url-b');
    const { rerender } = renderHook(({ f }) => useObjectUrl(f), {
      initialProps: { f: fileA },
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();
    rerender({ f: fileB });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-a');
    expect(createObjectURL).toHaveBeenCalledWith(fileB);
  });

  it('revokes the URL on unmount', () => {
    const file = new File(['c'], 'c.jpg', { type: 'image/jpeg' });
    const { unmount } = renderHook(() => useObjectUrl(file));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
  });
});
