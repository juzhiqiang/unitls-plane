import React, { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '@error-tracker/sdk';

const mocks = vi.hoisted(() => {
  class ReplayPlugin {
    name = 'ReplayPlugin';
    constructor(public options: unknown) {}
  }
  return {
    client: {},
    replayPlugin: ReplayPlugin,
  };
});

vi.mock('@error-tracker/sdk', () => ({
  init: vi.fn(() => mocks.client),
}));

vi.mock('@error-tracker/sdk/plugins/replay', () => ({
  ReplayPlugin: mocks.replayPlugin,
}));

describe('ErrorTrackerInit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN = 'http://localhost:3002/ingest/test-project';
    process.env.NEXT_PUBLIC_ERROR_TRACKER_TOKEN = 'test-token';
    process.env.NEXT_PUBLIC_RELEASE = 'test';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN;
    delete process.env.NEXT_PUBLIC_ERROR_TRACKER_TOKEN;
    delete process.env.NEXT_PUBLIC_RELEASE;
  });

  it('initializes the SDK with the configured DSN and token', async () => {
    const { ErrorTrackerInit } = await import('../error-tracker-init');

    render(<ErrorTrackerInit />);

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'http://localhost:3002/ingest/test-project',
        token: 'test-token',
        release: 'test',
      }),
    );
  });

  it('does not initialize when the DSN is missing', async () => {
    delete process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN;
    const { ErrorTrackerInit } = await import('../error-tracker-init');

    render(<ErrorTrackerInit />);

    expect(init).not.toHaveBeenCalled();
  });

  it('does not start a manual flush timer under StrictMode', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const { ErrorTrackerInit } = await import('../error-tracker-init');

    render(
      <StrictMode>
        <ErrorTrackerInit />
      </StrictMode>,
    );

    expect(init).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
