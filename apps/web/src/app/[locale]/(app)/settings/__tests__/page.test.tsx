import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../messages/en.json';
import zh from '../../../../../../messages/zh.json';
import { InstallProvider } from '@/components/pwa/install-provider';
import SettingsPage from '../page';

const mocks = vi.hoisted(() => ({
  sessionPlan: 'free' as string,
  deleteAccount: vi.fn(),
  downloadAccountExport: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

type InstallOutcome = 'accepted' | 'dismissed';

class MockBeforeInstallPromptEvent extends Event {
  prompt = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  userChoice: Promise<{ outcome: InstallOutcome; platform: string }>;

  constructor(outcome: InstallOutcome = 'accepted') {
    super('beforeinstallprompt', { cancelable: true });
    this.userChoice = Promise.resolve({ outcome, platform: 'web' });
  }
}

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'user-1',
        name: 'Owner',
        email: 'owner@example.com',
        emailVerified: true,
        image: null,
        createdAt: '2026-07-14T00:00:00.000Z',
        plan: mocks.sessionPlan,
      },
    },
    isPending: false,
    refetch: vi.fn(),
  }),
  authClient: { updateUser: vi.fn() },
  changePassword: vi.fn(),
  signOut: mocks.signOut,
}));

vi.mock('@/hooks/api/use-files', () => ({
  useUploadFile: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/api/use-account', () => ({
  downloadAccountExport: mocks.downloadAccountExport,
  useDeleteAccount: () => ({
    mutateAsync: mocks.deleteAccount,
    isPending: false,
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

function renderPage(
  locale: 'en' | 'zh' = 'en',
  messages: typeof en | typeof zh = en
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <InstallProvider>
        <SettingsPage />
      </InstallProvider>
    </NextIntlClientProvider>
  );
}

function dispatchInstallEvent(event: MockBeforeInstallPromptEvent) {
  act(() => {
    window.dispatchEvent(event);
  });
}

function enterConfirmation(value: string) {
  fireEvent.change(
    screen.getByRole('textbox', {
      name: 'Enter owner@example.com to confirm',
    }),
    { target: { value } }
  );
}

describe('SettingsPage account controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionPlan = 'free';
    mocks.downloadAccountExport.mockResolvedValue(undefined);
    mocks.deleteAccount.mockResolvedValue(undefined);
    mocks.signOut.mockResolvedValue(undefined);
  });

  it('shows the localized free beta label instead of the plan id', () => {
    renderPage();

    expect(screen.getByText('Free beta (Free Beta)')).toBeInTheDocument();
    expect(screen.queryByText(/^free$/i)).not.toBeInTheDocument();
  });

  it.each([
    ['pro_preview', 'Free beta with top limits (Pro Preview)'],
    ['pro', 'Professional (Pro)'],
    ['team', 'Team (Team)'],
    ['private', 'Private (Private)'],
  ])('shows the localized label for the %s plan', (plan, label) => {
    mocks.sessionPlan = plan;

    renderPage();

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows Chinese plan descriptions followed by their English identifiers', () => {
    mocks.sessionPlan = 'pro_preview';

    renderPage('zh', zh);

    expect(
      screen.getByText('免费公测顶额权益（Pro Preview）')
    ).toBeInTheDocument();
  });

  it('uses a safe label for an unknown plan id', () => {
    mocks.sessionPlan = 'legacy_plan';

    renderPage();

    expect(screen.getByText('Unknown plan (Unknown)')).toBeInTheDocument();
  });

  it('does not show app installation when the browser has no install event', () => {
    renderPage();

    expect(
      screen.queryByRole('button', { name: 'Install app' })
    ).not.toBeInTheDocument();
  });

  it('shows app installation after the browser install event', () => {
    renderPage();

    dispatchInstallEvent(new MockBeforeInstallPromptEvent());

    expect(
      screen.getByRole('button', { name: 'Install app' })
    ).toBeInTheDocument();
  });

  it('reports success only when installation is accepted', async () => {
    renderPage();
    const event = new MockBeforeInstallPromptEvent('accepted');
    dispatchInstallEvent(event);

    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    await waitFor(() => {
      expect(event.prompt).toHaveBeenCalledTimes(1);
      expect(mocks.toastSuccess).toHaveBeenCalledWith('App installed');
    });
  });

  it('does not report success when installation is dismissed', async () => {
    renderPage();
    const event = new MockBeforeInstallPromptEvent('dismissed');
    dispatchInstallEvent(event);

    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('App installed');
  });

  it('reports installation failure and returns when the browser offers a new event', async () => {
    renderPage();
    const failedEvent = new MockBeforeInstallPromptEvent();
    failedEvent.prompt.mockRejectedValue(new Error('prompt failed'));
    dispatchInstallEvent(failedEvent);

    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'App installation could not start. Try again when the install option is available.'
      );
    });

    const retryEvent = new MockBeforeInstallPromptEvent();
    dispatchInstallEvent(retryEvent);
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    await waitFor(() => expect(retryEvent.prompt).toHaveBeenCalledTimes(1));
  });

  it('does not prompt twice after a rapid double click', async () => {
    let resolvePrompt: (() => void) | undefined;
    renderPage();
    const event = new MockBeforeInstallPromptEvent();
    event.prompt.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolvePrompt = resolve;
        })
    );
    dispatchInstallEvent(event);

    const installButton = screen.getByRole('button', { name: 'Install app' });
    fireEvent.click(installButton);
    fireEvent.click(installButton);

    expect(event.prompt).toHaveBeenCalledTimes(1);
    resolvePrompt?.();
    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
  });

  it('shows export progress then restores an enabled button after download starts', async () => {
    let finishDownload: (() => void) | undefined;
    mocks.downloadAccountExport.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finishDownload = resolve;
        })
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Export all data' }));

    expect(
      screen.getByRole('button', { name: 'Preparing export...' })
    ).toBeDisabled();
    finishDownload?.();

    expect(
      await screen.findByRole('status', { name: 'Download started' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export again' })).toBeEnabled();
  });

  it('shows export start failure and retries browser navigation', async () => {
    mocks.downloadAccountExport
      .mockRejectedValueOnce(new Error('Account export request failed'))
      .mockResolvedValueOnce(undefined);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Export all data' }));

    const retry = await screen.findByRole('button', {
      name: 'Retry data export',
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The export could not be downloaded. Try again.'
    );

    fireEvent.click(retry);
    expect(
      await screen.findByRole('status', { name: 'Download started' })
    ).toBeInTheDocument();
    expect(mocks.downloadAccountExport).toHaveBeenCalledTimes(2);
  });

  it('enables and submits permanent deletion only for the normalized current email', async () => {
    renderPage();
    const deleteButton = screen.getByRole('button', {
      name: 'Permanently delete account',
    });

    expect(deleteButton).toBeDisabled();
    enterConfirmation('other@example.com');
    expect(deleteButton).toBeDisabled();
    enterConfirmation(' OWNER@EXAMPLE.COM ');
    expect(deleteButton).toBeEnabled();

    fireEvent.click(deleteButton);
    await waitFor(() => {
      expect(mocks.deleteAccount).toHaveBeenCalledWith('owner@example.com');
    });
  });

  it('navigates home and refreshes after deletion even when sign-out fails', async () => {
    mocks.signOut.mockRejectedValue(new Error('session already deleted'));
    renderPage();
    enterConfirmation('owner@example.com');

    fireEvent.click(
      screen.getByRole('button', { name: 'Permanently delete account' })
    );

    await waitFor(() => {
      expect(mocks.deleteAccount).toHaveBeenCalledWith('owner@example.com');
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
      expect(mocks.replace).toHaveBeenCalledWith('/');
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('stays on the page and permits retry after deletion fails', async () => {
    mocks.deleteAccount.mockRejectedValue(
      new Error('Account deletion is incomplete')
    );
    renderPage();
    enterConfirmation('owner@example.com');

    fireEvent.click(
      screen.getByRole('button', { name: 'Permanently delete account' })
    );

    const retry = await screen.findByRole('button', {
      name: 'Retry account deletion',
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Account deletion failed. Your account remains available; try again.'
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledTimes(2));
  });
});
