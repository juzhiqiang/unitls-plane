import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../messages/en.json';
import SettingsPage from '../page';

const mocks = vi.hoisted(() => ({
  deleteAccount: vi.fn(),
  downloadAccountExport: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
}));

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
        plan: 'free',
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
  toast: { error: vi.fn(), success: vi.fn() },
}));

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SettingsPage />
    </NextIntlClientProvider>
  );
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
    mocks.downloadAccountExport.mockResolvedValue(undefined);
    mocks.deleteAccount.mockResolvedValue(undefined);
    mocks.signOut.mockResolvedValue(undefined);
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

  it('shows export failure and retries the HTTP request', async () => {
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
