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

  it('renders the generated id photo preview after the task completes', async () => {
    mocks.useSession.mockReturnValue({
      data: { user: { name: 'Tester', email: 't@example.com' } },
      isPending: false,
    });
    const uploadMutate = vi.fn().mockResolvedValue({ id: 'input-file-1' });
    const taskMutate = vi.fn().mockResolvedValue({ id: 'task-1' });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: uploadMutate });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: taskMutate });

    const fetchMock = vi.fn().mockResolvedValue({
      blob: () =>
        Promise.resolve(new Blob(['result'], { type: 'image/jpeg' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderPage();

    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    // react-dropzone 异步触发 onDrop:等待「生成」按钮出现后再点击
    const startButton = await screen.findByRole('button', {
      name: 'Generate ID photo',
    });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(taskMutate).toHaveBeenCalled();
    });

    await act(async () => {
      await mocks.onCompleted('output-file-1');
    });

    // 完成后上传预览 + 结果预览都使用同一 alt,应至少两张
    const previews = await screen.findAllByAltText('ID photo preview');
    expect(previews.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
