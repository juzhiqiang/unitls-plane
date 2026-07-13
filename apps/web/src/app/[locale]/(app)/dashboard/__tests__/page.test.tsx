import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../messages/en.json';
import DashboardPage from '../page';

const mocks = vi.hoisted(() => ({
  useAccountSummary: vi.fn(),
  useTasks: vi.fn(),
  useFiles: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement('a', { href, ...props }, children),
}));

vi.mock('@/hooks/api/use-account', () => ({
  useAccountSummary: () => mocks.useAccountSummary(),
}));

vi.mock('@/hooks/api/use-tasks', () => ({
  useTasks: () => mocks.useTasks(),
}));

vi.mock('@/hooks/api/use-files', () => ({
  useFiles: () => mocks.useFiles(),
}));

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <DashboardPage />
    </NextIntlClientProvider>
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAccountSummary.mockReturnValue({
      data: {
        activeTaskCount: 7,
        failedTaskCount: 4,
        activeFileCount: 23,
        activeFileBytes: 1536,
        recentTasks: [
          {
            id: 'task-summary',
            userId: 'user-1',
            type: 'pdf_merge',
            status: 'completed',
            inputFileIds: ['file-input'],
            progress: 100,
            createdAt: '2026-07-14T00:00:00.000Z',
          },
        ],
        recentFiles: [
          {
            id: 'file-summary',
            filename: 'result.pdf',
            originalSize: 1536,
            mimeType: 'application/pdf',
            createdAt: '2026-07-14T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: mocks.refetch,
    });
    mocks.useTasks.mockReturnValue({
      data: {
        tasks: [
          {
            id: 'task-page',
            type: 'compress',
            status: 'pending',
            createdAt: '2026-07-13T00:00:00.000Z',
          },
        ],
      },
    });
    mocks.useFiles.mockReturnValue({
      data: {
        files: [
          {
            id: 'file-page',
            filename: 'page-only.png',
            mimeType: 'image/png',
            createdAt: '2026-07-13T00:00:00.000Z',
          },
        ],
      },
    });
  });

  it('renders full account totals and recent rows from the summary endpoint', () => {
    renderPage();

    expect(mocks.useAccountSummary).toHaveBeenCalledTimes(1);
    expect(mocks.useTasks).not.toHaveBeenCalled();
    expect(mocks.useFiles).not.toHaveBeenCalled();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
    expect(screen.getByText('Total Files: 23')).toBeInTheDocument();
    expect(screen.getByText('PDF merge')).toBeInTheDocument();
    expect(screen.getByText('result.pdf')).toBeInTheDocument();
    expect(screen.queryByText('page-only.png')).not.toBeInTheDocument();
  });

  it('renders a loading state without showing zero account values', () => {
    mocks.useAccountSummary.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mocks.refetch,
    });

    renderPage();

    expect(
      screen.getByRole('status', { name: 'Loading account summary' })
    ).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0 B')).not.toBeInTheDocument();
  });

  it('renders a retryable error without showing zero account values', () => {
    mocks.useAccountSummary.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mocks.refetch,
    });

    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load your account summary."
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0 B')).not.toBeInTheDocument();
  });
});
