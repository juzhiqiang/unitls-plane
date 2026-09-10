'use client';

import { useCallback, useState } from 'react';

export function useCursorPagination(scope: string) {
  const [state, setState] = useState({ scope, cursors: [''], index: 0 });
  const current =
    state.scope === scope ? state : { scope, cursors: [''], index: 0 };
  if (state.scope !== scope) setState(current);
  const reset = useCallback(
    () => setState({ scope, cursors: [''], index: 0 }),
    [scope]
  );
  return {
    cursor: current.cursors[current.index],
    page: current.index + 1,
    reset,
    previous: () =>
      setState(prev =>
        prev === state ? { ...prev, index: Math.max(0, prev.index - 1) } : prev
      ),
    next: (cursor: string | null | undefined) => {
      if (!cursor) return;
      setState(prev =>
        prev === state
          ? {
              scope,
              cursors: [...prev.cursors.slice(0, prev.index + 1), cursor],
              index: prev.index + 1,
            }
          : prev
      );
    },
  };
}
