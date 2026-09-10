'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useCursorPagination(scope: string) {
  const [state, setState] = useState({ scope, cursors: [''], index: 0 });
  const latestScope = useRef(scope);
  const stateRef = useRef(state);
  latestScope.current = scope;
  if (stateRef.current.scope !== scope)
    stateRef.current = {
      scope,
      cursors: [''],
      index: 0,
    };
  const current =
    state.scope === scope ? state : { scope, cursors: [''], index: 0 };
  useEffect(() => {
    if (state.scope !== scope) setState(stateRef.current);
  }, [scope, state.scope]);
  const commit = useCallback(
    (next: typeof state) => {
      if (latestScope.current !== scope) return;
      if (next === stateRef.current) return;
      stateRef.current = next;
      setState(next);
    },
    [scope]
  );
  const reset = useCallback(() => {
    commit({ scope, cursors: [''], index: 0 });
  }, [commit, scope]);
  const previous = useCallback(() => {
    const currentState = stateRef.current;
    if (currentState.scope !== scope) return;
    commit({
      ...currentState,
      index: Math.max(0, currentState.index - 1),
    });
  }, [commit, scope]);
  const next = useCallback(
    (cursor: string | null | undefined) => {
      if (!cursor) return;
      const currentState = stateRef.current;
      if (
        currentState.scope !== scope ||
        currentState.cursors[currentState.index] === cursor
      ) {
        return;
      }
      commit({
        scope,
        cursors: [
          ...currentState.cursors.slice(0, currentState.index + 1),
          cursor,
        ],
        index: currentState.index + 1,
      });
    },
    [commit, scope]
  );
  return {
    cursor: current.cursors[current.index],
    page: current.index + 1,
    reset,
    previous,
    next,
  };
}
