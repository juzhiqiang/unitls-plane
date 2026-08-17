import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../../messages/en.json';
import IdPhotoPage from '../page';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useUploadFile: vi.fn(),
  useCreateTask: vi.fn(),
  useTaskProgress: vi.fn(),
  onCompleted: vi.fn(),
  onFailed: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
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
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => mocks.useSession() },
}));

vi.mock('@/hooks/api/use-files', () => ({
  useUploadFile: () => mocks.useUploadFile(),
}));

vi.mock('@/hooks/api/use-tasks', () => ({
  useCreateTask: () => mocks.useCreateTask(),
}));

vi.mock('@/hooks/api/use-task-progress', () => ({
  useTaskProgress: (
    _taskId: string | null,
    options?: {
      onCompleted?: (id: string) => void;
      onFailed?: (e: { code: string; message: string }) => void;
    }
  ) => {
    mocks.onCompleted.mockImplementation(options?.onCompleted ?? (() => {}));
    mocks.onFailed.mockImplementation(options?.onFailed ?? (() => {}));
    return mocks.useTaskProgress();
  },
}));

// jsdom 未实现 URL.createObjectURL
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:preview-url'),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
});

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <IdPhotoPage />
    </NextIntlClientProvider>
  );
}

function makeFile() {
  return new File(['pixel-data'], 'photo.jpg', { type: 'image/jpeg' });
}

describe('IdPhotoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: vi.fn() });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: vi.fn() });
    mocks.useTaskProgress.mockReturnValue({ data: undefined });
  });

  it('renders an uploaded image preview after a file is dropped', async () => {
    const { container } = renderPage();
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    const img = await screen.findByAltText('ID photo preview');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toBe('blob:preview-url');
  });
});
