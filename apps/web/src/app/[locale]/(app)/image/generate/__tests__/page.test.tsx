import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../../messages/en.json';
import ImageGeneratePage from '../page';

/**
 * 对话式生图页测试:沿用全 hook 手动 mock + 真实 en.json 的骨架。
 * 服务端数据(会话列表/会话任务)是可变变量,提交后把 createTask 收到的
 * inputConfig 回填成任务行,再 rerender 模拟 query 刷新 —— 这也是真实链路
 * 的顺序:提交 → 任务落库(带 sessionId/clientGroupId)→ 会话任务 query 刷新。
 */
const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  createTask: vi.fn(),
  uploadFile: vi.fn(),
  push: vi.fn(),
  invalidate: vi.fn(),
  imageGenerateQuota: vi.fn(),
  imageGenerateProviders: vi.fn(),
  imageGeneratePresets: vi.fn(),
  imageGenerateSessions: vi.fn(),
  sessionTasks: vi.fn(),
  previews: vi.fn(),
  outputLoad: vi.fn(),
  retryTask: vi.fn(),
  maxReferenceSize: vi.fn(),
  deleteSession: vi.fn(),
}));

const PRESETS = [
  {
    id: 'preset-uuid-1',
    title: 'Guided science picture book',
    prompt: 'Create a high-finish guided science picture book illustration.',
    imageStorageKey: 'science-picture-book.jpg',
    sortOrder: 0,
  },
  {
    id: 'preset-uuid-2',
    title: 'Mind map & knowledge graph',
    prompt: 'Generate a mind-map infographic, educational-poster style.',
    sortOrder: 1,
  },
];

const DEFAULT_PROVIDER = {
  id: 'default',
  label: 'Default',
  capabilities: ['generate', 'edit'] as const,
  sizes: [
    'auto',
    '1024x1024',
    '1024x1536',
    '1536x1024',
    '864x1152',
    '1152x864',
    '864x1536',
    '1536x864',
  ],
};

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => mocks.useSession() },
}));

vi.mock('@/hooks/use-require-login', () => ({
  useRequireLogin: () => ({
    session: mocks.useSession().data,
    requireLogin: (returnUrl: string) => {
      if (!mocks.useSession().data) {
        mocks.push(`/login?next=${encodeURIComponent(returnUrl)}`);
        return true;
      }
      return false;
    },
  }),
}));

vi.mock('@/hooks/api/use-tasks', () => ({
  useCreateTask: () => ({ mutateAsync: mocks.createTask }),
  useImageGenerateQuota: () => mocks.imageGenerateQuota(),
  useImageGenerateProviders: () => mocks.imageGenerateProviders(),
  useImageGeneratePresets: () => mocks.imageGeneratePresets(),
  useImageGenerateSessions: () => mocks.imageGenerateSessions(),
  useImageGenerateSessionTasks: (sessionId: string) =>
    mocks.sessionTasks(sessionId),
  useRetryTask: () => ({ mutate: mocks.retryTask }),
  useDeleteImageGenerateSession: () => ({
    mutate: mocks.deleteSession,
    isPending: false,
    variables: null,
  }),
}));

vi.mock('@/hooks/api/use-files', () => ({
  useUploadFile: () => ({ mutateAsync: mocks.uploadFile }),
}));

vi.mock('@/hooks/api/use-task-output', () => ({
  useTaskOutputPreviews: () => ({
    previews: mocks.previews(),
    load: mocks.outputLoad,
    reset: vi.fn(),
  }),
}));

vi.mock('@/hooks/api/use-file-preview', () => ({
  useFilePreviewUrl: () => 'blob:file-preview',
}));

vi.mock('@/hooks/use-object-url', () => ({
  useObjectUrl: () => 'blob:object-url',
}));

vi.mock('@/hooks/use-object-urls', () => ({
  useObjectUrls: (files: File[]) => files.map(() => 'blob:object-url'),
}));

vi.mock('@/lib/tools/image-limits', () => ({
  getImageUploadMaxFileSize: () => mocks.maxReferenceSize(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));

// 对比滑块是 dynamic import 的重组件,这里只断言它被渲染。
vi.mock('@/components/tools/image-generate-compare', () => ({
  ImageGenerateCompare: ({ title }: { title: string }) =>
    React.createElement('div', { 'data-testid': 'compare-slider' }, title),
}));

// 蒙版编辑器依赖真实 canvas(画笔/撤销),jsdom 里没有:这里打桩成"一键提交",
// 页面接线(编辑入口 → inpaint 任务创建)由此覆盖,画布交互走浏览器 E2E。
vi.mock('@/components/tools/image-generate/mask-editor', () => ({
  MaskEditor: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onSubmit: (payload: {
      maskBlob: Blob;
      prompt: string;
      width: number;
      height: number;
    }) => void;
  }) =>
    open
      ? React.createElement(
          'button',
          {
            'data-testid': 'stub-inpaint-submit',
            onClick: () =>
              onSubmit({
                maskBlob: new Blob(['mask-bytes']),
                prompt: 'make it a night sky',
                width: 1024,
                height: 1024,
              }),
          },
          'stub-inpaint-submit'
        )
      : null,
}));

type ServerTask = {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  inputConfig: Record<string, unknown>;
  inputFileIds: string[];
  outputFileId?: string;
  errorCode?: string;
};

let serverTasks: ServerTask[];
let taskSeq: number;

function renderPage() {
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ImageGeneratePage />
    </NextIntlClientProvider>
  );
  const rerender = () =>
    view.rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <ImageGeneratePage />
      </NextIntlClientProvider>
    );
  return { ...view, rerender };
}

function referenceFile(size = 8) {
  return new File(['x'.repeat(size)], 'source.png', { type: 'image/png' });
}

/** 从 createTask 调用里取 inputConfig,回填成服务端任务并 rerender。 */
function syncServerTasks(rerender: () => void) {
  // mockReturnValue 捕获的是当时的数组引用,重赋值后必须重新喂给 mock。
  serverTasks = mocks.createTask.mock.calls.map(([payload], index) => {
    const config = payload.inputConfig as Record<string, unknown>;
    return {
      id: `task-${index + 1}`,
      status: 'pending' as const,
      inputConfig: config,
      inputFileIds: payload.inputFileIds as string[],
    };
  });
  refreshSessionTasks(rerender);
  return serverTasks;
}

/**
 * 就地改任务字段后刷新页面:useMemo 按 sessionTasks 引用缓存,原地突变不会
 * 触发重算,这里喂一个浅拷贝新数组模拟 react-query 重新 fetch 的行为。
 */
function refreshSessionTasks(rerender: () => void) {
  mocks.sessionTasks.mockReturnValue({
    data: { tasks: [...serverTasks], total: serverTasks.length },
  });
  rerender();
}

function setPrompt(value: string) {
  fireEvent.change(
    screen.getByPlaceholderText(/Describe the image you want/),
    { target: { value } }
  );
}

function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Generation settings' }));
}

function attachViaInput(container: HTMLElement, files: File | File[]) {
  const input = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [files].flat() } });
}

beforeEach(() => {
  vi.clearAllMocks();
  serverTasks = [];
  taskSeq = 0;
  mocks.useSession.mockReturnValue({ data: { user: { id: 'user-1' } } });
  mocks.createTask.mockImplementation(async () => {
    taskSeq += 1;
    return { id: `task-${taskSeq}` };
  });
  mocks.uploadFile.mockImplementation(async () => ({ id: 'file-9' }));
  mocks.imageGenerateQuota.mockReturnValue({
    data: { limit: 10, used: 3, remaining: 7 },
  });
  mocks.imageGenerateProviders.mockReturnValue({ data: [DEFAULT_PROVIDER] });
  mocks.imageGeneratePresets.mockReturnValue({ data: PRESETS });
  mocks.imageGenerateSessions.mockReturnValue({ data: [] });
  mocks.sessionTasks.mockReturnValue({ data: { tasks: serverTasks, total: 0 } });
  mocks.previews.mockReturnValue({});
  mocks.outputLoad.mockResolvedValue(undefined);
  mocks.maxReferenceSize.mockReturnValue(1024 * 1024);
  vi.stubEnv('NEXT_PUBLIC_S3_PUBLIC_URL', 'http://minio.test:9000');
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

describe('ImageGeneratePage', () => {
  it('redirects an anonymous visitor to login instead of creating tasks', async () => {
    mocks.useSession.mockReturnValue({ data: null });
    renderPage();

    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        `/login?next=${encodeURIComponent('/image/generate')}`
      )
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled until a prompt is entered', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('creates one task per image sharing sessionId and clientGroupId', async () => {
    const { rerender } = renderPage();
    setPrompt('a shiba inu');

    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Increase image count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(2));

    const configs = mocks.createTask.mock.calls.map(
      ([payload]) => payload.inputConfig
    );
    expect(configs[0]).toMatchObject({
      mode: 'text_to_image',
      prompt: 'a shiba inu',
      size: 'auto',
      quality: 'auto',
    });
    expect(configs[0]).not.toHaveProperty('background');
    // 同一次提交:N 个任务共享 sessionId 与 clientGroupId,且都是 uuid 形状。
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const key of ['sessionId', 'clientGroupId']) {
      expect(configs.map(config => config[key])).toEqual([
        configs[0][key],
        configs[0][key],
      ]);
      expect(configs[0][key]).toMatch(UUID);
    }
    // 串行提交:第二个调用发生在第一个 resolve 之后(mock 实现本身按序 resolve,
    // 断言调用次数即可,并发与否由 mock 顺序保证不了,这里只钉住契约形状)。
    expect(mocks.createTask.mock.calls[0][0].inputFileIds).toEqual([]);
    expect(mocks.createTask.mock.calls[1][0].inputFileIds).toEqual([]);
    void rerender;
  });

  it('surfaces the daily quota error without creating more tasks', async () => {
    mocks.createTask.mockRejectedValueOnce({
      code: 'AI_IMAGE_DAILY_LIMIT_EXCEEDED',
    });
    renderPage();

    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(
        screen.getByText("You have used today's quota. Try again tomorrow.")
      ).toBeInTheDocument()
    );
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });

  it('renders a failure notice when the session task query keeps erroring', async () => {
    mocks.sessionTasks.mockReturnValue({
      data: undefined,
      isError: true,
    });
    renderPage();
    setPrompt('a shiba inu');

    await screen.findByText('Generation failed. Please try again.');
  });

  it('uploads the reference once and reuses the fileId for image_to_image', async () => {
    const { container } = renderPage();
    setPrompt('turn it into a watercolor');
    attachViaInput(container, referenceFile());
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    expect(mocks.createTask.mock.calls[0][0]).toMatchObject({
      inputFileIds: ['file-9'],
    });
    expect(mocks.createTask.mock.calls[0][0].inputConfig).toMatchObject({
      mode: 'image_to_image',
    });
  });

  it('accepts a pasted reference image and switches to image_to_image', async () => {
    renderPage();
    setPrompt('remix this');
    const textarea = screen.getByPlaceholderText(/Describe the image you want/);
    fireEvent.paste(textarea, {
      clipboardData: { files: [referenceFile()] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.createTask.mock.calls[0][0].inputConfig).toMatchObject({
      mode: 'image_to_image',
    });
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('removing the reference chip falls back to text_to_image', async () => {
    const { container } = renderPage();
    setPrompt('remix this');
    attachViaInput(container, referenceFile());
    fireEvent.click(screen.getByRole('button', { name: 'Remove reference image' }));

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.createTask.mock.calls[0][0].inputConfig).toMatchObject({
      mode: 'text_to_image',
    });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects an oversized reference image with an inline notice', () => {
    const { container } = renderPage();
    attachViaInput(container, referenceFile(2 * 1024 * 1024));

    expect(
      screen.getByText(/exceeds the size limit/)
    ).toBeInTheDocument();
    expect(screen.queryByAltText('source.png')).not.toBeInTheDocument();
  });

  it('does not create tasks when the reference upload fails', async () => {
    mocks.uploadFile.mockRejectedValue(new Error('boom'));
    const { container } = renderPage();
    setPrompt('remix this');
    attachViaInput(container, referenceFile());
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(
        screen.getByText('Uploading the reference image failed. Please try again.')
      ).toBeInTheDocument()
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('disables the reference entry when the provider cannot edit', () => {
    mocks.imageGenerateProviders.mockReturnValue({
      data: [
        {
          id: 't2i-only',
          label: 'Text only',
          capabilities: ['generate'] as const,
          sizes: ['auto', '1024x1024'],
        },
      ],
    });
    renderPage();

    expect(
      screen.getByRole('button', { name: 'Attach reference image' })
    ).toBeDisabled();
  });

  it('shows images and per-image downloads once previews are fetched', async () => {
    const { rerender } = renderPage();
    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));

    // 任务落库(query 刷新)→ completed + outputFileId → 页面发起取回。
    const [task] = syncServerTasks(rerender);
    task.status = 'completed';
    task.outputFileId = 'file-out-1';
    refreshSessionTasks(rerender);

    await waitFor(() =>
      expect(mocks.outputLoad).toHaveBeenCalledWith('task-1', 'file-out-1')
    );

    mocks.previews.mockReturnValue({
      'task-1': { state: 'ready', url: 'blob:image-1' },
    });
    rerender();

    const image = await screen.findByAltText('Image 1');
    expect(image).toHaveAttribute('src', 'blob:image-1');
    const download = screen.getByRole('link', { name: 'Download' });
    expect(download).toHaveAttribute('href', 'blob:image-1');
  });

  it('stays busy until the fetched image is actually visible', async () => {
    const { rerender } = renderPage();
    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));

    const [task] = syncServerTasks(rerender);
    task.status = 'completed';
    task.outputFileId = 'file-out-1';
    refreshSessionTasks(rerender);

    // 取回仍在 loading:按钮保持禁用(busy 时文案变为 Generating)。
    mocks.previews.mockReturnValue({
      'task-1': { state: 'loading' },
    });
    rerender();
    expect(screen.getByRole('button', { name: 'Generating' })).toBeDisabled();

    mocks.previews.mockReturnValue({
      'task-1': { state: 'ready', url: 'blob:image-1' },
    });
    rerender();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
  });

  it('offers a fetch retry (not a regeneration) when the download fails', async () => {
    const { rerender } = renderPage();
    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));

    const [task] = syncServerTasks(rerender);
    task.status = 'completed';
    task.outputFileId = 'file-out-1';
    refreshSessionTasks(rerender);
    mocks.previews.mockReturnValue({
      'task-1': { state: 'error' },
    });
    rerender();

    fireEvent.click(
      screen.getByRole('button', { name: /Retry fetch/ })
    );
    expect(mocks.outputLoad).toHaveBeenCalledTimes(2);
    // 重试取回不再触发生成:总调用数不变。
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error and a regenerate action for a failed task', async () => {
    const { rerender } = renderPage();
    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));

    const [task] = syncServerTasks(rerender);
    task.status = 'failed';
    task.errorCode = 'AI_IMAGE_CONTENT_REJECTED';
    refreshSessionTasks(rerender);

    expect(
      screen.getByText('The prompt was rejected by the content policy. Try rephrasing it.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(mocks.retryTask).toHaveBeenCalledWith('task-1');
  });

  it('derives ratio chips from provider sizes and hides the model row for a single provider', () => {
    renderPage();
    openSettings();

    expect(screen.getByText('Aspect ratio')).toBeInTheDocument();
    // DEFAULT_PROVIDER.sizes → 比例行 Auto/1:1/2:3/3:2;质量行也有一枚 Auto。
    expect(screen.getAllByText('Auto').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1:1')).toBeInTheDocument();
    expect(screen.getByText('2:3')).toBeInTheDocument();
    expect(screen.getByText('3:2')).toBeInTheDocument();
    // 新增四档常见比例(SDXL 系尺寸,gcd 约分出标签)。
    expect(screen.getByText('3:4')).toBeInTheDocument();
    expect(screen.getByText('4:3')).toBeInTheDocument();
    expect(screen.getByText('9:16')).toBeInTheDocument();
    expect(screen.getByText('16:9')).toBeInTheDocument();
    // 单来源部署不渲染模型行。
    expect(screen.queryByText('Model')).not.toBeInTheDocument();
    // 背景与质量行存在。
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.getByText('Transparent')).toBeInTheDocument();
  });

  it('shows the model row with the provider dropdown for multi-source setups', () => {
    mocks.imageGenerateProviders.mockReturnValue({
      data: [
        DEFAULT_PROVIDER,
        {
          id: 'kmage',
          label: 'Kmage',
          capabilities: ['generate', 'edit'] as const,
          sizes: ['auto', '1024x1024'],
        },
      ],
    });
    renderPage();
    openSettings();

    expect(screen.getByText('Model')).toBeInTheDocument();
    // 'Default' 同时是背景默认 chip 与当前来源名;下拉内容(Radix)关闭时不渲染,
    // 这里断言触发器显示当前来源即可。
    expect(screen.getAllByText('Default').length).toBeGreaterThanOrEqual(1);
  });

  it('caps the count stepper at the remaining quota', () => {
    mocks.imageGenerateQuota.mockReturnValue({
      data: { limit: 10, used: 9, remaining: 1 },
    });
    renderPage();
    openSettings();

    const increment = screen.getByRole('button', {
      name: 'Increase image count',
    });
    // 剩 1 张:+ 直接不可点。
    expect(increment).toBeDisabled();
  });

  it('falls back to the first supported size when the draft size is not declared', async () => {
    // 来源没声明 "auto"(严格网关的常态):提交值回落到第一档,不发送 auto。
    mocks.imageGenerateProviders.mockReturnValue({
      data: [
        {
          id: 'wan',
          label: 'wan',
          capabilities: ['generate', 'edit'] as const,
          sizes: ['1024x1024', '1024x1536'],
        },
      ],
    });
    renderPage();
    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.createTask.mock.calls[0][0].inputConfig).toMatchObject({
      size: '1024x1024',
    });
  });

  it('uploads every reference once and fuses them into image_to_image', async () => {
    const { container } = renderPage();
    mocks.uploadFile.mockImplementation(async () => ({
      id: `file-${Math.floor(Math.random() * 1000)}`,
    }));
    // 两次上传返回固定 id,mockImplementation 顺序递增更可控:
    let seq = 9;
    mocks.uploadFile.mockImplementation(async () => {
      seq += 1;
      return { id: `file-${seq}` };
    });
    setPrompt('fuse these two photos');
    attachViaInput(container, [
      referenceFile(),
      new File(['y'], 'source2.png', { type: 'image/png' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.uploadFile).toHaveBeenCalledTimes(2);
    expect(mocks.createTask.mock.calls[0][0]).toMatchObject({
      inputFileIds: ['file-10', 'file-11'],
    });
    expect(mocks.createTask.mock.calls[0][0].inputConfig).toMatchObject({
      mode: 'image_to_image',
    });
  });

  it('caps references at four images and surfaces the limit notice', () => {
    const { container } = renderPage();
    attachViaInput(
      container,
      Array.from({ length: 5 }, (_, i) => new File(['z'], `s${i}.png`, { type: 'image/png' }))
    );

    expect(
      screen.getByText(/At most 4 reference images/)
    ).toBeInTheDocument();
    // 只收前 4 张:第 5 张没有缩略 chip。
    expect(screen.getAllByRole('button', { name: 'Enlarge reference image' })).toHaveLength(4);
  });

  it('deletes a session after inline confirmation and switches to a new chat', async () => {
    const sessionId = '0f0d7ac5-4d3a-4a9e-9a75-2f76db11a001';
    mocks.imageGenerateSessions.mockReturnValue({
      data: [
        {
          sessionId,
          title: 'delete me',
          taskCount: 1,
          createdAt: '2026-09-07T10:00:00Z',
          updatedAt: '2026-09-07T10:05:00Z',
        },
      ],
    });
    // 让 mock mutate 同步触发 onSuccess,模拟真实 mutation 的成功回调。
    mocks.deleteSession.mockImplementation(
      (_sessionId: string, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.();
      }
    );
    renderPage();

    // 点删除 → 行内确认 → 确认删除。
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));

    await waitFor(() =>
      expect(mocks.deleteSession).toHaveBeenCalledWith(
        sessionId,
        expect.anything()
      )
    );
    // 删除的是当前会话:query 切到新的本地会话 id。
    const lastId = mocks.sessionTasks.mock.calls.at(-1)?.[0];
    expect(lastId).not.toBe(sessionId);
  });

  it('edits a completed image via the mask editor and submits an inpaint task', async () => {
    // 来源声明 inpaint 能力,编辑入口才会出现。
    mocks.imageGenerateProviders.mockReturnValue({
      data: [
        {
          id: 'kmage',
          label: 'Kmage',
          capabilities: ['generate', 'edit', 'inpaint'] as const,
          sizes: ['auto', '1024x1024'],
        },
      ],
    });
    const { rerender } = renderPage();
    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));

    const [task] = syncServerTasks(rerender);
    task.status = 'completed';
    task.outputFileId = 'file-out-1';
    refreshSessionTasks(rerender);
    mocks.previews.mockReturnValue({
      'task-1': { state: 'ready', url: 'blob:image-1' },
    });
    rerender();

    // 编辑入口 → 打桩的编辑器 → 提交。
    fireEvent.click(screen.getByRole('button', { name: 'Edit region' }));
    const stubSubmit = await screen.findByTestId('stub-inpaint-submit');

    // 原图从 blob url 取回:给一个可用的全局 fetch。
    let uploads = 100;
    mocks.uploadFile.mockImplementation(async () => {
      uploads += 1;
      return { id: `file-${uploads}` };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
      }))
    );

    fireEvent.click(stubSubmit);

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(2));
    const [payload] = mocks.createTask.mock.calls[1];
    expect(payload).toMatchObject({
      type: 'image_generate',
      inputFileIds: ['file-101', 'file-102'],
    });
    expect(payload.inputConfig).toMatchObject({
      mode: 'inpaint',
      prompt: 'make it a night sky',
      // 原始 1024x1024 在来源 sizes 里,原样下发。
      size: '1024x1024',
    });
  });

  it('hides the edit entry when the provider has no inpaint capability', async () => {
    const { rerender } = renderPage();
    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));

    const [task] = syncServerTasks(rerender);
    task.status = 'completed';
    task.outputFileId = 'file-out-1';
    refreshSessionTasks(rerender);
    mocks.previews.mockReturnValue({
      'task-1': { state: 'ready', url: 'blob:image-1' },
    });
    rerender();

    expect(
      screen.queryByRole('button', { name: 'Edit region' })
    ).not.toBeInTheDocument();
  });

  it('opens a before/after compare dialog when clicking an inpaint result', async () => {
    const { rerender } = renderPage();
    setPrompt('a shiba inu');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));

    const [task] = syncServerTasks(rerender);
    task.status = 'completed';
    task.outputFileId = 'file-out-1';
    (task.inputConfig as Record<string, unknown>).mode = 'inpaint';
    task.inputFileIds = ['file-base-1', 'file-mask-1'];
    refreshSessionTasks(rerender);
    mocks.previews.mockReturnValue({
      'task-1': { state: 'ready', url: 'blob:image-1' },
    });
    rerender();

    // inpaint 结果的点击语义是「修改前后对比」,不再走放大预览。
    fireEvent.click(
      screen.getByRole('button', { name: 'Before / after edit' })
    );
    expect(await screen.findByTestId('compare-slider')).toBeInTheDocument();
  });

  it('fills the prompt when picking a template from the empty state', () => {
    renderPage();

    fireEvent.click(
      screen.getByRole('button', {
        name: /Guided science picture book/,
      })
    );

    const textarea = screen.getByPlaceholderText(
      /Describe the image you want/
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe(PRESETS[0].prompt);
  });

  it('lists sessions, loads the selected session tasks and resets on new chat', async () => {
    const sessionId = '0f0d7ac5-4d3a-4a9e-9a75-2f76db11a001';
    mocks.imageGenerateSessions.mockReturnValue({
      data: [
        {
          sessionId,
          title: 'a shiba in a top hat',
          taskCount: 2,
          createdAt: '2026-09-07T10:00:00Z',
          updatedAt: '2026-09-07T10:05:00Z',
        },
      ],
    });
    const { rerender } = renderPage();

    fireEvent.click(screen.getByText('a shiba in a top hat'));
    await waitFor(() =>
      expect(mocks.sessionTasks).toHaveBeenLastCalledWith(sessionId)
    );

    // 切回去(新对话):query 跟着切回新会话 id(uuid,非 sessionId)。
    fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[0]);
    const lastId = mocks.sessionTasks.mock.calls.at(-1)?.[0];
    expect(lastId).not.toBe(sessionId);
    void rerender;
  });

  it('shows the quota line only for signed-in users', () => {
    const { rerender } = renderPage();
    expect(screen.getByText(/7 \/ 10 remaining today/)).toBeInTheDocument();

    mocks.useSession.mockReturnValue({ data: null });
    rerender();
    expect(screen.queryByText(/remaining today/)).not.toBeInTheDocument();
  });
});
