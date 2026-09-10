import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../../messages/en.json';
import TrashPage from '../page';
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}));

const mocks = vi.hoisted(() => ({
  useTrashedFiles: vi.fn(),
  restoreMutate: vi.fn(),
  permanentDeleteMutateAsync: vi.fn(),
  batchRestoreMutateAsync: vi.fn(),
  batchPermanentDeleteMutateAsync: vi.fn(),
  emptyTrashMutateAsync: vi.fn(),
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

vi.mock('@/hooks/api/use-files', () => ({
  useTrashedFiles: (query: unknown, userId: string | undefined) =>
    mocks.useTrashedFiles(query, userId),
  useRestoreFile: () => ({
    mutate: mocks.restoreMutate,
    isPending: false,
  }),
  usePermanentDeleteFile: () => ({
    mutateAsync: mocks.permanentDeleteMutateAsync,
    isPending: false,
  }),
  useBatchRestoreFiles: () => ({
    mutateAsync: mocks.batchRestoreMutateAsync,
    isPending: false,
  }),
  useBatchPermanentDeleteFiles: () => ({
    mutateAsync: mocks.batchPermanentDeleteMutateAsync,
    isPending: false,
  }),
  useEmptyTrash: () => ({
    mutateAsync: mocks.emptyTrashMutateAsync,
    isPending: false,
  }),
}));

const trashedFiles = [
  {
    id: 'file-1',
    userId: 'user-1',
    filename: 'report.pdf',
    originalSize: 2048,
    storageKey: 'user-1/file-1/report.pdf',
    bucket: 'uploads',
    mimeType: 'application/pdf',
    metadata: null,
    expiresAt: null,
    deletedAt: '2026-05-29T00:00:00.000Z',
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
  },
  {
    id: 'file-2',
    userId: 'user-1',
    filename: 'photo.png',
    originalSize: 1024,
    storageKey: 'user-1/file-2/photo.png',
    bucket: 'uploads',
    mimeType: 'image/png',
    metadata: null,
    expiresAt: null,
    deletedAt: '2026-05-29T00:00:00.000Z',
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
  },
];

function renderTrashPage() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TrashPage />
    </NextIntlClientProvider>
  );
}

it('requests cursor pages without counts and supports back navigation', () => {
  mocks.useTrashedFiles.mockReturnValue({
    data: { files: trashedFiles, total: null, nextCursor: 'next-boundary' },
    isLoading: false,
  });
  renderTrashPage();
  expect(mocks.useTrashedFiles).toHaveBeenLastCalledWith(
    {
      cursor: '',
      limit: 12,
      includeTotal: false,
    },
    'user-1'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  expect(mocks.useTrashedFiles).toHaveBeenLastCalledWith(
    {
      cursor: 'next-boundary',
      limit: 12,
      includeTotal: false,
    },
    'user-1'
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Previous', exact: true })
  );
  expect(mocks.useTrashedFiles).toHaveBeenLastCalledWith(
    {
      cursor: '',
      limit: 12,
      includeTotal: false,
    },
    'user-1'
  );
});

describe('TrashPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useTrashedFiles.mockReturnValue({
      data: { files: trashedFiles, total: trashedFiles.length },
      isLoading: false,
    });
    mocks.permanentDeleteMutateAsync.mockResolvedValue({ success: true });
    mocks.batchRestoreMutateAsync.mockResolvedValue({ success: true });
    mocks.batchPermanentDeleteMutateAsync.mockResolvedValue({ success: true });
    mocks.emptyTrashMutateAsync.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('batch restores selected trashed files', async () => {
    mocks.useTrashedFiles.mockReturnValue({
      data: { files: trashedFiles, total: null, nextCursor: 'boundary' },
      isLoading: false,
    });
    renderTrashPage();
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    fireEvent.click(screen.getByLabelText('Select report.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected' }));

    await waitFor(() => {
      expect(mocks.batchRestoreMutateAsync).toHaveBeenCalledWith(['file-1']);
      expect(mocks.useTrashedFiles).toHaveBeenLastCalledWith(
        {
          cursor: '',
          limit: 12,
          includeTotal: false,
        },
        'user-1'
      );
      expect(screen.getByLabelText('Select report.pdf')).not.toBeChecked();
    });
  });

  it('confirms before batch permanent delete and empty trash', async () => {
    mocks.useTrashedFiles.mockReturnValue({
      data: { files: trashedFiles, total: null, nextCursor: 'boundary' },
      isLoading: false,
    });
    renderTrashPage();

    fireEvent.click(screen.getByLabelText('Select report.pdf'));
    fireEvent.click(screen.getByLabelText('Select photo.png'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete selected permanently' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm delete selected' })
    );

    await waitFor(() => {
      expect(mocks.batchPermanentDeleteMutateAsync).toHaveBeenCalledWith([
        'file-1',
        'file-2',
      ]);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm empty trash' })
    );

    await waitFor(() => {
      expect(mocks.emptyTrashMutateAsync).toHaveBeenCalledTimes(1);
      expect(mocks.useTrashedFiles).toHaveBeenLastCalledWith(
        {
          cursor: '',
          limit: 12,
          includeTotal: false,
        },
        'user-1'
      );
    });
  });
});
