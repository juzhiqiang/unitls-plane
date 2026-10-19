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
import {
  idPhotoCropFromBox,
  idPhotoCropFromLayout,
  resolveIdPhotoCropBox,
  type IdPhotoCrop,
  type IdPhotoLayout,
  type QualityReport,
} from '@utils-plane/validators';
import en from '../../../../../../messages/en.json';
import IdPhotoPage from '@/app/[locale]/(app)/image/id-photo/page';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useUploadFile: vi.fn(),
  useCreateTask: vi.fn(),
  useTaskProgress: vi.fn(),
  useLocalIdPhoto: vi.fn(),
  localProcess: vi.fn(),
  localMarkUserOverride: vi.fn(),
  localReset: vi.fn(),
  cropFieldProps: {
    current: null as null | {
      value: { x: number; y: number; width: number; height: number } | null;
      guides?: boolean;
      onChange: (rect: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => void;
    },
  },
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

// 本地 hook 会被页面读取 autoLayout/userOverride/quality 等状态;测试里用可控
// 的 mock 代替真实推理,只验证页面接线。
vi.mock('@/lib/id-photo-local/use-local-id-photo', () => ({
  useLocalIdPhoto: () => mocks.useLocalIdPhoto(),
}));

// 包一层真实裁剪组件:保留 DOM 行为(现有预览用例依赖它),同时记录页面传入
// 的 value/guides,便于断言自动构图回填和辅助线开关。
vi.mock('@/components/tools/image-crop-field', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/components/tools/image-crop-field')
    >();
  return {
    ImageCropField: (
      props: React.ComponentProps<typeof actual.ImageCropField>
    ) => {
      mocks.cropFieldProps.current = props;
      return actual.ImageCropField(props);
    },
  };
});

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

function makeLocalState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'idle',
    progress: 0,
    ep: null,
    error: null,
    resultBlob: null,
    autoLayout: null,
    userOverride: false,
    quality: null,
    process: mocks.localProcess,
    markUserOverride: mocks.localMarkUserOverride,
    reset: mocks.localReset,
    ...overrides,
  };
}

const SOURCE = { width: 1200, height: 1600 };
// 一寸规格 295×413,与页面默认 preset 一致。
const PRESET = { widthPx: 295, heightPx: 413 };
const AUTO_LAYOUT: IdPhotoLayout = {
  zoom: 130,
  offsetX: 6,
  offsetY: -4,
  rotation: 0,
  faceRatio: 0.35,
  faceTopMargin: 0.1,
};
const DEFAULT_CROP: IdPhotoCrop = { x: 0.5, y: 0.5, scale: 1 };

/** 页面把 crop 换算成裁剪框后传给 ImageCropField 的矩形。 */
function cropRectFor(crop: IdPhotoCrop) {
  const box = resolveIdPhotoCropBox(
    SOURCE.width,
    SOURCE.height,
    PRESET.widthPx,
    PRESET.heightPx,
    crop
  );
  return {
    x: box.left,
    y: box.top,
    width: box.width,
    height: box.height,
  };
}

async function dropPhoto(container: HTMLElement) {
  const input = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [makeFile()] } });
  await screen.findByRole('button', { name: 'Generate ID photo' });
}

/**
 * jsdom 不会真的解码图片,naturalWidth/Height 恒为 0。页面依赖
 * ImageCropField 的 onLoad 回填 natural,这里手动给尺寸并触发 load。
 */
async function loadCropImage(size = SOURCE) {
  const img = await screen.findByAltText('Crop preview');
  Object.defineProperty(img, 'naturalWidth', {
    value: size.width,
    configurable: true,
  });
  Object.defineProperty(img, 'naturalHeight', {
    value: size.height,
    configurable: true,
  });
  fireEvent.load(img);
  return img;
}

const QUALITY_REPORT: QualityReport = {
  items: [
    {
      name: 'faceCount',
      value: '1',
      passed: true,
      hint: 'singleFrontalPortrait',
    },
  ],
  score: 100,
  passed: true,
};

describe('IdPhotoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: vi.fn() });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: vi.fn() });
    mocks.useTaskProgress.mockReturnValue({ data: undefined });
    mocks.useLocalIdPhoto.mockReturnValue(makeLocalState());
    mocks.localProcess.mockReset();
    mocks.localMarkUserOverride.mockReset();
    mocks.localReset.mockReset();
    mocks.cropFieldProps.current = null;
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

describe('IdPhotoPage local auto framing and quality wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    mocks.useLocalIdPhoto.mockReturnValue(makeLocalState());
    mocks.localProcess.mockReset();
    mocks.localMarkUserOverride.mockReset();
    mocks.localReset.mockReset();
    mocks.cropFieldProps.current = null;
  });

  it('backfills the crop box once the local auto layout arrives', async () => {
    mocks.useLocalIdPhoto.mockReturnValue(
      makeLocalState({ autoLayout: AUTO_LAYOUT })
    );
    const { container } = renderPage();
    await dropPhoto(container);
    await loadCropImage();

    const expected = cropRectFor(
      idPhotoCropFromLayout(
        AUTO_LAYOUT,
        SOURCE,
        PRESET.widthPx / PRESET.heightPx
      )
    );
    // 自动构图回填的框必须与默认居中框不同,否则这条断言没有区分力
    expect(expected).not.toEqual(cropRectFor(DEFAULT_CROP));

    await waitFor(() => {
      expect(mocks.cropFieldProps.current?.value).toEqual(expected);
    });
  });

  it('does not backfill the crop box after the user has overridden it', async () => {
    mocks.useLocalIdPhoto.mockReturnValue(
      makeLocalState({ autoLayout: AUTO_LAYOUT, userOverride: true })
    );
    const { container } = renderPage();
    await dropPhoto(container);
    await loadCropImage();

    await waitFor(() => {
      expect(mocks.cropFieldProps.current?.value).toEqual(
        cropRectFor(DEFAULT_CROP)
      );
    });
    expect(mocks.cropFieldProps.current?.value).not.toEqual(
      cropRectFor(
        idPhotoCropFromLayout(
          AUTO_LAYOUT,
          SOURCE,
          PRESET.widthPx / PRESET.heightPx
        )
      )
    );
  });

  it('marks a user override before applying a crop box change', async () => {
    const { container } = renderPage();
    await dropPhoto(container);
    await loadCropImage();

    act(() => {
      mocks.cropFieldProps.current?.onChange({
        x: 100,
        y: 200,
        width: 400,
        height: 560,
      });
    });

    expect(mocks.localMarkUserOverride).toHaveBeenCalledTimes(1);
    expect(mocks.cropFieldProps.current?.value).toEqual(
      cropRectFor(
        idPhotoCropFromBox(
          SOURCE.width,
          SOURCE.height,
          PRESET.widthPx,
          PRESET.heightPx,
          { left: 100, top: 200, width: 400, height: 560 }
        )
      )
    );
  });

  it('passes autoFrame to the local process unless the user changed the crop', async () => {
    const { container, unmount } = renderPage();
    await dropPhoto(container);
    fireEvent.click(screen.getByRole('button', { name: 'Generate ID photo' }));

    expect(mocks.localProcess).toHaveBeenCalledWith(
      expect.any(File),
      'balanced',
      expect.objectContaining({ autoFrame: true })
    );

    unmount();
    mocks.localProcess.mockReset();
    mocks.useLocalIdPhoto.mockReturnValue(
      makeLocalState({ userOverride: true })
    );
    const second = renderPage();
    await dropPhoto(second.container);
    fireEvent.click(screen.getByRole('button', { name: 'Generate ID photo' }));

    expect(mocks.localProcess).toHaveBeenCalledWith(
      expect.any(File),
      'balanced',
      expect.objectContaining({ autoFrame: false })
    );
  });

  it('renders the quality panel when local processing produced a report', async () => {
    mocks.useLocalIdPhoto.mockReturnValue(
      makeLocalState({
        status: 'done',
        resultBlob: new Blob(['result'], { type: 'image/jpeg' }),
        quality: QUALITY_REPORT,
      })
    );
    const { container } = renderPage();
    await dropPhoto(container);

    expect(await screen.findByTestId('id-photo-quality-panel')).toBeVisible();
    expect(screen.getByText('All checks passed')).toBeInTheDocument();
    expect(screen.getByText('Score 100')).toBeInTheDocument();
  });

  it('shows “Check unavailable” when a local result has no quality report', async () => {
    mocks.useLocalIdPhoto.mockReturnValue(
      makeLocalState({
        status: 'done',
        resultBlob: new Blob(['result'], { type: 'image/jpeg' }),
        quality: null,
      })
    );
    const { container } = renderPage();
    await dropPhoto(container);

    expect(await screen.findByText('Check unavailable')).toBeInTheDocument();
    expect(
      screen.queryByTestId('id-photo-quality-panel')
    ).not.toBeInTheDocument();
  });

  it('does not render the quality panel in server mode', async () => {
    const { container } = renderPage();
    await dropPhoto(container);
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));

    expect(screen.queryByText('Check unavailable')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('id-photo-quality-panel')
    ).not.toBeInTheDocument();
  });

  it('passes the guides toggle through to the crop field', async () => {
    const { container } = renderPage();
    await dropPhoto(container);
    await loadCropImage();

    expect(mocks.cropFieldProps.current?.guides).toBe(false);

    fireEvent.click(screen.getByTestId('id-photo-guides-toggle'));

    expect(mocks.cropFieldProps.current?.guides).toBe(true);
  });
});
