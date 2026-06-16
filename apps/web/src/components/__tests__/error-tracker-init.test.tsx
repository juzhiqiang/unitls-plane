import React, { StrictMode } from 'react';
import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorTrackerInit } from '../error-tracker-init';
import { init } from '@error-tracker/sdk';

const mocks = vi.hoisted(() => {
  const flush = vi.fn();
  class ReplayPlugin {
    name = 'ReplayPlugin';
    constructor(public options: unknown) {}
  }
  return {
    flush,
    client: { flush },
    replayPlugin: ReplayPlugin,
  };
});

vi.mock('@error-tracker/sdk', () => ({
  init: vi.fn(() => mocks.client),
  getClient: vi.fn(() => mocks.client),
}));

vi.mock('@error-tracker/sdk/plugins/replay', () => ({
  ReplayPlugin: mocks.replayPlugin,
}));

describe('ErrorTrackerInit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN = 'http://localhost:3002/ingest/test-project';
    process.env.NEXT_PUBLIC_RELEASE = 'test';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN;
    delete process.env.NEXT_PUBLIC_RELEASE;
  });

  it('keeps flushing after StrictMode cleanup remounts the component', () => {
    render(
      <StrictMode>
        <ErrorTrackerInit />
      </StrictMode>,
    );

    expect(init).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(mocks.flush).toHaveBeenCalledTimes(1);
  });
});
