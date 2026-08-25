import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../messages/en.json';
import FilesPage from '../page';

const mocks = vi.hoisted(() => ({
  useFiles: vi.fn(),
  useFile: vi.fn(),
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/hooks/api/use-files', () => ({
  useFiles: () => mocks.useFiles(),
  useFile: (id: string) => mocks.useFile(id),
  useDeleteFile: () => ({ mutate: vi.fn(), isPending: false }),
  useBatchDeleteFiles: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: null }) },
}));

const smallImage = {
  id: 'file-1',
  userId: 'user-1',
  filename: 'shot.png',
  originalSize: 1024,
  storageKey: 'k1',
  bucket: 'uploads',
  mimeType: 'image/png',
  metadata: null,
  expiresAt: null,
  deletedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};
const largeImage = {
  ...smallImage,
  id: 'file-2',
  filename: 'huge.png',
  originalSize: 8 * 1024 * 1024,
};
const fontFile = {
  ...smallImage,
  id: 'file-3',
  filename: 'Inter.woff2',
  mimeType: 'font/woff2',
};

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en as never}>
      <FilesPage />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  mocks.replace.mockReset();
  mocks.useFile.mockReturnValue({ data: undefined, isLoading: false });
  mocks.useFiles.mockReturnValue({
    data: { files: [smallImage, largeImage, fontFile], total: 3 },
    isLoading: false,
  });
});

describe('FilesPage preview', () => {
  it('renders a thumbnail only for small images', () => {
    renderPage();

    expect(screen.getByAltText('shot.png')).toBeInTheDocument();
    expect(screen.queryByAltText('huge.png')).toBeNull();
  });

  it('offers preview for images and pdfs but not fonts', () => {
    renderPage();

    expect(screen.getAllByLabelText('Preview shot.png').length).toBeGreaterThan(
      0
    );
    expect(screen.queryByLabelText('Preview Inter.woff2')).toBeNull();
  });

  it('opens the preview dialog from the list without refetching the file', () => {
    renderPage();

    fireEvent.click(screen.getAllByLabelText('Preview shot.png')[0]!);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.useFile).toHaveBeenCalledWith('');
  });

  it('opens the preview dialog from a ?preview= deep link and fetches that file', () => {
    mocks.searchParams = new URLSearchParams('preview=file-9');
    mocks.useFile.mockReturnValue({
      data: { ...smallImage, id: 'file-9', filename: 'from-task.png' },
      isLoading: false,
    });

    renderPage();

    expect(mocks.useFile).toHaveBeenCalledWith('file-9');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByAltText('from-task.png')).toBeInTheDocument();
  });

  it('clears the deep link query when the preview closes', () => {
    mocks.searchParams = new URLSearchParams('preview=file-9');
    mocks.useFile.mockReturnValue({
      data: { ...smallImage, id: 'file-9', filename: 'from-task.png' },
      isLoading: false,
    });

    renderPage();
    fireEvent.click(screen.getByLabelText(en.FilesTool.previewClose));

    expect(mocks.replace).toHaveBeenCalledWith('/files');
  });
});
