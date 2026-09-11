import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCursorPagination } from '../use-cursor-pagination';

describe('cursor pagination', () => {
  it('starts with an empty cursor and navigates visited boundaries', () => {
    const { result } = renderHook(() => useCursorPagination('user/filter'));
    expect(result.current.cursor).toBe('');
    act(() => result.current.next('one'));
    expect(result.current.page).toBe(2);
    expect(result.current.cursor).toBe('one');
    act(() => result.current.next('two'));
    act(() => result.current.previous());
    expect(result.current.cursor).toBe('one');
    act(() => result.current.reset());
    expect(result.current.page).toBe(1);
  });
  it('resets immediately when filters or owner change', () => {
    const { result, rerender } = renderHook(
      ({ scope }) => useCursorPagination(scope),
      { initialProps: { scope: 'a' } }
    );
    act(() => result.current.next('one'));
    rerender({ scope: 'b' });
    expect(result.current.cursor).toBe('');
    expect(result.current.page).toBe(1);
  });
  it('ignores absent cursors and duplicate navigation in the same render', () => {
    const { result } = renderHook(() => useCursorPagination('a'));
    act(() => {
      result.current.next('one');
      result.current.next('one');
    });
    expect(result.current.page).toBe(2);
    act(() => result.current.next(null));
    expect(result.current.page).toBe(2);
  });
  it('ignores navigation callbacks captured by an older scope', () => {
    let renders = 0;
    const { result, rerender } = renderHook(
      ({ scope }) => {
        renders += 1;
        return useCursorPagination(scope);
      },
      { initialProps: { scope: 'a' } }
    );
    act(() => result.current.next('one'));
    const staleNext = result.current.next;
    rerender({ scope: 'b' });
    act(() => {});
    const rendersBeforeStaleNavigation = renders;

    act(() => staleNext('stale'));

    expect(renders).toBe(rendersBeforeStaleNavigation);
    expect(result.current.cursor).toBe('');
    expect(result.current.page).toBe(1);
  });
});
