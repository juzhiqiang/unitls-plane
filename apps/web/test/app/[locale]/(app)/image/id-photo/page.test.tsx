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
  localResetResult: vi.fn(),
  localResetAll: vi.fn(),
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
  /** markUserOverride 与 setOptions 引起的渲染共用一个序列,用来验证调用顺序。 */
  effectSequence: [] as string[],
  /** 有状态版本地 hook 的可控状态;仅在换图用例里启用。 */
  localStore: {
    current: null as ReturnType<typeof makeLocalState> | null,
  },
  localRerender: { current: null as (() => void) | null },
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
      // setOptions 没有可观测的副作用,用「裁剪组件按新 value 重渲染」作为
      // 状态已应用的信号,与 markUserOverride 放进同一个序列比较先后。
      mocks.effectSequence.push('crop-render');
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

function makeFile(name = 'photo.jpg') {
  return new File(['pixel-data'], name, { type: 'image/jpeg' });
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
    resetResult: mocks.localResetResult,
    resetAll: mocks.localResetAll,
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

async function dropPhoto(container: HTMLElement, file: File = makeFile()) {
  const input = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole('button', { name: 'Generate ID photo' });
}

/**
 * 有状态版本的 useLocalIdPhoto mock。
 *
 * 静态 makeLocalState 无法验证「换图后状态被清空」——reset 只是个 spy,页面渲染
 * 读到的仍是旧返回值。这里用页面自身的 React 渲染循环保存状态:reset 真正把
 * 状态归零并触发重渲染,因此既能断言 store 字段,也能断言质量面板确实消失。
 */
function installStatefulLocal(initial: ReturnType<typeof makeLocalState>) {
  mocks.localStore.current = initial;
  mocks.useLocalIdPhoto.mockImplementation(() => {
    const [, force] = React.useReducer((count: number) => count + 1, 0);
    mocks.localRerender.current = force;
    const state = mocks.localStore.current ?? makeLocalState();
    return {
      ...state,
      process: mocks.localProcess,
      // 与真实 hook 一致:resetResult 保留 userOverride,resetAll 连它一起清。
      resetResult: () => {
        mocks.localResetResult();
        const current = mocks.localStore.current ?? makeLocalState();
        mocks.localStore.current = {
          ...current,
          status: 'idle',
          progress: 0,
          error: null,
          resultBlob: null,
          autoLayout: null,
          quality: null,
        };
        mocks.localRerender.current?.();
      },
      resetAll: () => {
        mocks.localResetAll();
        mocks.localStore.current = makeLocalState();
        mocks.localRerender.current?.();
      },
      markUserOverride: () => {
        mocks.localMarkUserOverride();
        mocks.localStore.current = {
          ...(mocks.localStore.current ?? makeLocalState()),
          userOverride: true,
          autoLayout: null,
        };
        mocks.localRerender.current?.();
      },
    };
  });
}

/** 模拟一次本地处理完成:写入 autoLayout/quality/resultBlob 等结果字段。 */
function setLocalState(partial: Partial<ReturnType<typeof makeLocalState>>) {
  mocks.localStore.current = {
    ...(mocks.localStore.current ?? makeLocalState()),
    ...partial,
  };
  act(() => {
    mocks.localRerender.current?.();
  });
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
    mocks.useLocalIdPhoto.mockReset();
    mocks.useLocalIdPhoto.mockReturnValue(makeLocalState());
    mocks.localProcess.mockReset();
    mocks.localMarkUserOverride.mockReset();
    mocks.localResetResult.mockReset();
    mocks.localResetAll.mockReset();
    mocks.cropFieldProps.current = null;
    mocks.effectSequence.length = 0;
    mocks.localStore.current = null;
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

describe('IdPhotoPage server auto framing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({
      data: { user: { name: 'Tester', email: 't@example.com' } },
      isPending: false,
    });
    mocks.useLocalIdPhoto.mockReset();
    mocks.useLocalIdPhoto.mockReturnValue(makeLocalState());
    mocks.useTaskProgress.mockReturnValue({ data: undefined });
    mocks.localProcess.mockReset();
    mocks.localMarkUserOverride.mockReset();
    mocks.localResetResult.mockReset();
    mocks.localResetAll.mockReset();
    mocks.cropFieldProps.current = null;
    mocks.effectSequence.length = 0;
    mocks.localStore.current = null;
  });

  async function submitServerTask() {
    const uploadMutate = vi.fn().mockResolvedValue({ id: 'input-file-1' });
    const taskMutate = vi.fn().mockResolvedValue({ id: 'task-1' });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: uploadMutate });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: taskMutate });

    const { container } = renderPage();
    await dropPhoto(container);
    await loadCropImage();
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate ID photo' })
    );
    await waitFor(() => expect(taskMutate).toHaveBeenCalled());
    const config = (
      taskMutate.mock.calls[0]![0] as {
        inputConfig: Record<string, unknown>;
      }
    ).inputConfig;
    return config;
  }

  it('omits crop so the server can auto-frame when the user has not adjusted the box', async () => {
    installStatefulLocal(makeLocalState());
    const config = await submitServerTask();

    // 无条件发送 {x:0.5,y:0.5,scale:1} 会让服务端跳过人脸自动构图与旋转。
    expect('crop' in config).toBe(false);
    expect(config.crop).toBeUndefined();
  });

  it('sends the current crop after the user adjusts the box on the server path', async () => {
    installStatefulLocal(makeLocalState());
    const uploadMutate = vi.fn().mockResolvedValue({ id: 'input-file-1' });
    const taskMutate = vi.fn().mockResolvedValue({ id: 'task-1' });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: uploadMutate });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: taskMutate });

    const { container } = renderPage();
    await dropPhoto(container);
    await loadCropImage();
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));

    // 服务端模式下用户拖框同样要算 override,否则手动构图会被服务端自动构图覆盖。
    act(() => {
      mocks.cropFieldProps.current?.onChange({
        x: 100,
        y: 200,
        width: 400,
        height: 560,
      });
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate ID photo' })
    );
    await waitFor(() => expect(taskMutate).toHaveBeenCalled());

    const config = (
      taskMutate.mock.calls[0]![0] as {
        inputConfig: Record<string, unknown>;
      }
    ).inputConfig;
    expect(config.crop).toEqual(
      idPhotoCropFromBox(
        SOURCE.width,
        SOURCE.height,
        PRESET.widthPx,
        PRESET.heightPx,
        { left: 100, top: 200, width: 400, height: 560 }
      )
    );
  });

  it('keeps a manual crop when switching from local to server mode', async () => {
    // 回归:切模式曾调用整体 reset,清掉 userOverride 却保留 options.crop。
    // 结果框里仍显示手动构图,服务端却收不到 crop,自动构图把它覆盖掉。
    installStatefulLocal(makeLocalState());
    const uploadMutate = vi.fn().mockResolvedValue({ id: 'input-file-1' });
    const taskMutate = vi.fn().mockResolvedValue({ id: 'task-1' });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: uploadMutate });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: taskMutate });

    const { container } = renderPage();
    await dropPhoto(container);
    await loadCropImage();

    // 默认本地模式下拖动裁剪框。
    act(() => {
      mocks.cropFieldProps.current?.onChange({
        x: 100,
        y: 200,
        width: 400,
        height: 560,
      });
    });
    expect(mocks.localStore.current?.userOverride).toBe(true);

    // 只观察切模式这一次调用(拖入文件时 handleDrop 已调过一次 resetAll)。
    mocks.localResetResult.mockClear();
    mocks.localResetAll.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));

    // 切模式只能清结果,不能清 override;裁剪框也应保持手动值。
    expect(mocks.localResetResult).toHaveBeenCalled();
    expect(mocks.localResetAll).not.toHaveBeenCalled();
    expect(mocks.localStore.current?.userOverride).toBe(true);
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

    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate ID photo' })
    );
    await waitFor(() => expect(taskMutate).toHaveBeenCalled());

    const config = (
      taskMutate.mock.calls[0]![0] as {
        inputConfig: Record<string, unknown>;
      }
    ).inputConfig;
    expect(config.crop).toEqual(
      idPhotoCropFromBox(
        SOURCE.width,
        SOURCE.height,
        PRESET.widthPx,
        PRESET.heightPx,
        { left: 100, top: 200, width: 400, height: 560 }
      )
    );
  });

  it('still omits crop when switching from local to server without adjusting the box', async () => {
    installStatefulLocal(makeLocalState());
    const uploadMutate = vi.fn().mockResolvedValue({ id: 'input-file-1' });
    const taskMutate = vi.fn().mockResolvedValue({ id: 'task-1' });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: uploadMutate });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: taskMutate });

    const { container } = renderPage();
    await dropPhoto(container);
    await loadCropImage();
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));

    // 未手动改框:resetResult 后 override 仍为 false,服务端自动构图继续生效。
    expect(mocks.localStore.current?.userOverride).toBe(false);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate ID photo' })
    );
    await waitFor(() => expect(taskMutate).toHaveBeenCalled());

    const config = (
      taskMutate.mock.calls[0]![0] as {
        inputConfig: Record<string, unknown>;
      }
    ).inputConfig;
    expect('crop' in config).toBe(false);
  });
});

describe('IdPhotoPage local auto framing and quality wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({ data: null, isPending: false });
    mocks.useLocalIdPhoto.mockReset();
    mocks.useLocalIdPhoto.mockReturnValue(makeLocalState());
    mocks.localProcess.mockReset();
    mocks.localMarkUserOverride.mockReset();
    mocks.localResetResult.mockReset();
    mocks.localResetAll.mockReset();
    mocks.cropFieldProps.current = null;
    mocks.effectSequence.length = 0;
    mocks.localStore.current = null;
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

    // 只记录本次 onChange 引发的顺序:markUserOverride 是显式副作用,
    // setOptions 通过裁剪组件按新 value 重渲染来观测。
    mocks.effectSequence.length = 0;
    mocks.localMarkUserOverride.mockImplementation(() => {
      mocks.effectSequence.push('markUserOverride');
    });

    act(() => {
      mocks.cropFieldProps.current?.onChange({
        x: 100,
        y: 200,
        width: 400,
        height: 560,
      });
    });

    expect(mocks.localMarkUserOverride).toHaveBeenCalledTimes(1);
    const markIndex = mocks.effectSequence.indexOf('markUserOverride');
    const appliedIndex = mocks.effectSequence.indexOf('crop-render');
    expect(markIndex).toBeGreaterThanOrEqual(0);
    // 顺序反了(先 setOptions 再 mark)时,裁剪组件会先以旧值渲染,
    // 而 hook 的 autoFrame 守卫读 ref,会用旧值重跑自动构图。
    expect(appliedIndex).toBeGreaterThan(markIndex);
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

  it('clears the previous local result when a new photo replaces the processed one', async () => {
    installStatefulLocal(makeLocalState());
    const { container } = renderPage();
    await dropPhoto(container, makeFile('a.jpg'));

    // 模拟 A 图本地处理完成:autoLayout / quality / resultBlob 都有值。
    setLocalState({
      status: 'done',
      resultBlob: new Blob(['a'], { type: 'image/jpeg' }),
      autoLayout: AUTO_LAYOUT,
      quality: QUALITY_REPORT,
    });

    expect(await screen.findByTestId('id-photo-quality-panel')).toBeVisible();
    expect(mocks.localStore.current).toMatchObject({
      autoLayout: AUTO_LAYOUT,
      quality: QUALITY_REPORT,
      resultBlob: expect.any(Blob),
    });

    // 拖入 B 图:handleDrop 必须调用 resetAll,否则 A 的构图与质量报告会残留。
    await dropPhoto(container, makeFile('b.jpg'));

    expect(mocks.localResetAll).toHaveBeenCalled();
    expect(mocks.localStore.current).toMatchObject({
      autoLayout: null,
      quality: null,
      resultBlob: null,
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('id-photo-quality-panel')
      ).not.toBeInTheDocument();
    });
  });

  it('clears a previous user override so the next photo can auto frame again', async () => {
    installStatefulLocal(makeLocalState());
    const { container } = renderPage();
    await dropPhoto(container, makeFile('a.jpg'));

    // A 图:用户拖动过裁剪框,userOverride 置位(autoLayout 已被 hook 清空)。
    setLocalState({ status: 'done', userOverride: true, autoLayout: null });
    expect(mocks.localStore.current?.userOverride).toBe(true);

    await dropPhoto(container, makeFile('b.jpg'));

    // 行为验证:B 图不再继承 A 图的手动框,处理时仍走自动构图。
    expect(mocks.localResetAll).toHaveBeenCalled();
    expect(mocks.localResetResult).not.toHaveBeenCalled();
    expect(mocks.localStore.current?.userOverride).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Generate ID photo' }));
    expect(mocks.localProcess).toHaveBeenCalledWith(
      expect.any(File),
      'balanced',
      expect.objectContaining({ autoFrame: true })
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

  it('does not render the quality panel in server mode even when a result exists', async () => {
    // 之前只切到服务端就断言,没有服务端产物,近乎恒真。这里真的跑完一次
    // 服务端任务并拿到结果,确认结果区出现的同时质量面板仍不渲染。
    mocks.useSession.mockReturnValue({
      data: { user: { name: 'Tester', email: 't@example.com' } },
      isPending: false,
    });
    const uploadMutate = vi.fn().mockResolvedValue({ id: 'input-file-1' });
    const taskMutate = vi.fn().mockResolvedValue({ id: 'task-1' });
    mocks.useUploadFile.mockReturnValue({ mutateAsync: uploadMutate });
    mocks.useCreateTask.mockReturnValue({ mutateAsync: taskMutate });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () =>
          Promise.resolve(new Blob(['result'], { type: 'image/jpeg' })),
      })
    );

    const { container } = renderPage();
    await dropPhoto(container);
    fireEvent.click(screen.getByRole('button', { name: 'Server' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate ID photo' })
    );
    await waitFor(() => expect(taskMutate).toHaveBeenCalled());
    await act(async () => {
      await mocks.onCompleted('output-file-1');
    });

    // 服务端产物已渲染
    expect(await screen.findByAltText('ID photo preview')).toBeInTheDocument();
    // 但质量面板只属于本地路
    expect(
      screen.queryByTestId('id-photo-quality-panel')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Check unavailable')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
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
