import React, { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallProvider, useInstallApp } from '../install-provider';

type InstallOutcome = 'accepted' | 'dismissed';

class MockBeforeInstallPromptEvent extends Event {
  prompt = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  userChoice: Promise<{ outcome: InstallOutcome; platform: string }>;

  constructor(outcome: InstallOutcome = 'accepted') {
    super('beforeinstallprompt', { cancelable: true });
    this.userChoice = Promise.resolve({ outcome, platform: 'web' });
  }
}

function InstallConsumer() {
  const { canInstall, install } = useInstallApp();
  const [outcome, setOutcome] = useState<string | null>(null);

  return (
    <>
      <output>{canInstall ? 'available' : 'unavailable'}</output>
      {canInstall && (
        <button
          type="button"
          onClick={async () => {
            try {
              setOutcome(String(await install()));
            } catch {
              setOutcome('error');
            }
          }}
        >
          Install app
        </button>
      )}
      {outcome && <span>Outcome: {outcome}</span>}
    </>
  );
}

function AlwaysAvailableConsumer() {
  const { install } = useInstallApp();

  return (
    <button type="button" onClick={() => void install()}>
      Run install
    </button>
  );
}

function renderConsumer() {
  return render(
    <InstallProvider>
      <InstallConsumer />
    </InstallProvider>
  );
}

function dispatchInstallEvent(event: MockBeforeInstallPromptEvent) {
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('InstallProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not expose an install command before the browser event', () => {
    renderConsumer();

    expect(screen.getByText('unavailable')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Install app' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Install Utils-Plane')).not.toBeInTheDocument();
  });

  it('prevents the browser event and returns the accepted choice', async () => {
    renderConsumer();
    const event = new MockBeforeInstallPromptEvent('accepted');
    const preventDefault = vi.spyOn(event, 'preventDefault');

    dispatchInstallEvent(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(screen.getByText('available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    expect(await screen.findByText('Outcome: accepted')).toBeInTheDocument();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByText('unavailable')).toBeInTheDocument();
  });

  it('returns dismissed without reporting acceptance', async () => {
    renderConsumer();
    const event = new MockBeforeInstallPromptEvent('dismissed');
    dispatchInstallEvent(event);

    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    expect(await screen.findByText('Outcome: dismissed')).toBeInTheDocument();
    expect(screen.queryByText('Outcome: accepted')).not.toBeInTheDocument();
  });

  it('throws a clear error when the hook is used outside the provider', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const preventExpectedWindowError = (event: ErrorEvent) => {
      if (
        event.error instanceof Error &&
        event.error.message ===
          'useInstallApp must be used within an InstallProvider'
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('error', preventExpectedWindowError);

    try {
      expect(() => render(<InstallConsumer />)).toThrow(
        'useInstallApp must be used within an InstallProvider'
      );
    } finally {
      window.removeEventListener('error', preventExpectedWindowError);
      consoleError.mockRestore();
    }
  });

  it('removes browser listeners when unmounted', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderConsumer();

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith(
      'beforeinstallprompt',
      expect.any(Function)
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      'appinstalled',
      expect.any(Function)
    );
  });

  it('uses the newest browser event when multiple events arrive', async () => {
    renderConsumer();
    const firstEvent = new MockBeforeInstallPromptEvent();
    const latestEvent = new MockBeforeInstallPromptEvent();

    dispatchInstallEvent(firstEvent);
    dispatchInstallEvent(latestEvent);
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    await screen.findByText('Outcome: accepted');
    expect(firstEvent.prompt).not.toHaveBeenCalled();
    expect(latestEvent.prompt).toHaveBeenCalledTimes(1);
  });

  it('clears a failed event and lets the caller handle the error', async () => {
    renderConsumer();
    const event = new MockBeforeInstallPromptEvent();
    event.prompt.mockRejectedValue(new Error('prompt failed'));
    dispatchInstallEvent(event);

    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    expect(await screen.findByText('Outcome: error')).toBeInTheDocument();
    expect(screen.getByText('unavailable')).toBeInTheDocument();
  });

  it('does not prompt twice for concurrent install calls', async () => {
    let resolvePrompt: (() => void) | undefined;
    const event = new MockBeforeInstallPromptEvent();
    event.prompt.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolvePrompt = resolve;
        })
    );
    render(
      <InstallProvider>
        <AlwaysAvailableConsumer />
      </InstallProvider>
    );
    dispatchInstallEvent(event);

    const installButton = screen.getByRole('button', { name: 'Run install' });
    fireEvent.click(installButton);
    fireEvent.click(installButton);

    expect(event.prompt).toHaveBeenCalledTimes(1);
    resolvePrompt?.();
    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
  });
});
