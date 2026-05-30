import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallPrompt } from '../install-prompt';

class BeforeInstallPromptEvent extends Event {
  prompt = vi.fn();
}

describe('InstallPrompt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an install prompt after the browser install event', async () => {
    render(<InstallPrompt />);

    const event = new BeforeInstallPromptEvent('beforeinstallprompt', {
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(await screen.findByText('Install Utils-Plane')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(event.prompt).toHaveBeenCalledTimes(1);
    });
  });

  it('dismisses the prompt', async () => {
    render(<InstallPrompt />);

    window.dispatchEvent(
      new BeforeInstallPromptEvent('beforeinstallprompt', {
        cancelable: true,
      })
    );

    expect(await screen.findByText('Install Utils-Plane')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(screen.queryByText('Install Utils-Plane')).not.toBeInTheDocument();
    });
  });
});
