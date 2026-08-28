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

    // 上传的原图现在渲染在裁剪框里,alt 与结果预览区分开。
    const img = await screen.findByAltText('Crop preview');
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
      ok: true,
      blob: () => Promise.resolve(new Blob(['result'], { type: 'image/jpeg' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderPage();

    // ModeToggle 只在丢文件后渲染:先丢文件,再切服务端路,再触发生成
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    // react-dropzone 异步触发 onDrop:等待「生成」按钮出现后再切换模式
    await screen.findByRole('button', {
      name: 'Generate ID photo',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));

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

    // 裁剪预览与结果预览各有一张,alt 已区分
    expect(await screen.findByAltText('ID photo preview')).toBeInTheDocument();
    expect(screen.getByAltText('Crop preview')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();

    // 有成品照后才出现拼版面板,并按预设算出该相纸能排几张
    expect(screen.getByText('Print sheet')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Build print sheet' })
    ).toBeEnabled();

    vi.unstubAllGlobals();
  });

  it('defaults to local mode and renders the local start button', async () => {
    const { container } = renderPage();
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    const startButton = await screen.findByRole('button', {
      name: 'Generate ID photo',
    });
    expect(startButton).toBeInTheDocument();
    // 本地模式不显示 segmentation mode(标准/AI 精修)
    expect(screen.queryByText('Cutout mode')).not.toBeInTheDocument();
  });

  it('surfaces a failed product download instead of staying stuck on processing', async () => {
    // 以前 onCompleted 里没有 catch:下载一失败就永久卡在「处理中」,
    // 而且以未捕获 promise 漏出。现在走 useTaskOutput,失败会解除忙碌态并报错。
    mocks.useSession.mockReturnValue({
      data: { user: { name: 'Tester', email: 't@example.com' } },
      isPending: false,
    });
    const uploadMutate = vi.fn().mockResolvedValue({ id: 'input-file-1' });
    const taskMutate = vi.fn().mockResolvedValue({ id: 'task-1' });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: uploadMutate });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: taskMutate });

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderPage();
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await screen.findByRole('button', { name: 'Generate ID photo' });
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate ID photo' })
    );
    await waitFor(() => expect(taskMutate).toHaveBeenCalled());

    await act(async () => {
      await mocks.onCompleted('output-file-1');
    });

    expect(screen.getByText('Download failed')).toBeInTheDocument();
    // 按钮回到可点状态,而不是停在处理中文案上。
    expect(
      screen.getByRole('button', { name: 'Generate ID photo' })
    ).toBeEnabled();
    expect(screen.queryByAltText('ID photo preview')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('does not offer the print sheet before a photo exists', async () => {
    const { container } = renderPage();
    const input = container.querySelector(
      'input[type=\"file\"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await screen.findByRole('button', { name: 'Generate ID photo' });

    // 拼版依赖成品照,处理完成前不应出现
    expect(screen.queryByText('Print sheet')).not.toBeInTheDocument();
  });

  it('switching to server mode shows segmentation mode options', async () => {
    const { container } = renderPage();
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await screen.findByRole('button', { name: 'Generate ID photo' });

    fireEvent.click(screen.getByRole('button', { name: 'Server' }));
    expect(screen.getByText('Cutout mode')).toBeInTheDocument();
  });
});
