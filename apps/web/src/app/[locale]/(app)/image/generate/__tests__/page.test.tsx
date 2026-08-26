import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../../messages/en.json';
import ImageGeneratePage from '../page';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  createTask: vi.fn(),
  uploadFile: vi.fn(),
  push: vi.fn(),
  groupProgress: vi.fn(),
  onItemCompleted: vi.fn(),
  imageGenerateQuota: vi.fn(),
  imageGenerateProviders: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: () => mocks.useSession() },
}));

vi.mock('@/hooks/api/use-tasks', () => ({
  useCreateTask: () => ({ mutateAsync: mocks.createTask }),
  useImageGenerateQuota: () => mocks.imageGenerateQuota(),
  useImageGenerateProviders: () => mocks.imageGenerateProviders(),
}));

vi.mock('@/hooks/api/use-files', () => ({
  useUploadFile: () => ({ mutateAsync: mocks.uploadFile }),
}));

vi.mock('@/hooks/api/use-task-group-progress', () => ({
  useTaskGroupProgress: (
    _taskIds: string[],
    options?: { onItemCompleted?: (taskId: string, fileId: string) => void }
  ) => {
    // 捕获页面传入的 onItemCompleted(= loadPreview),测试里手动驱动某项完成,
    // 从而走通预览/下载路径。
    mocks.onItemCompleted.mockImplementation(
      options?.onItemCompleted ?? (() => {})
    );
    return mocks.groupProgress();
  },
}));

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ImageGeneratePage />
    </NextIntlClientProvider>
  );
}

function referenceFile() {
  return new File(['pixel-data'], 'source.png', { type: 'image/png' });
}

/**
 * 切到图生图并选一张参考图。
 *
 * react-dropzone 的 onDrop 是异步的(它自己 await fromEvent 解析 DataTransfer),
 * 所以必须等预览出现再继续 —— 否则后面点「Generate」时 sourceFile 还是 null,
 * 按钮仍处于 disabled,点击被静默丢掉。
 */
async function chooseReference(container: HTMLElement) {
  fireEvent.click(screen.getByRole('radio', { name: 'Image to image' }));
  const input = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [referenceFile()] } });
  await screen.findByAltText('Reference image preview');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useSession.mockReturnValue({ data: { user: { id: 'user-1' } } });
  mocks.groupProgress.mockReturnValue({
    items: [],
    completedCount: 0,
    failedCount: 0,
    settled: false,
    query: { isError: false },
  });
  mocks.createTask.mockImplementation(async () => ({ id: 'task-1' }));
  mocks.uploadFile.mockImplementation(async () => ({ id: 'file-9' }));
  mocks.imageGenerateQuota.mockReturnValue({
    data: { limit: 10, used: 3, remaining: 7 },
  });
  // 默认单来源:选择器不渲染,断言与多来源上线前完全一致。
  mocks.imageGenerateProviders.mockReturnValue({
    data: [
      { id: 'default', label: 'Default', capabilities: ['generate', 'edit'] },
    ],
  });
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

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
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

  it('creates one task per requested image with an empty input file list', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(2));
    expect(mocks.createTask).toHaveBeenCalledWith({
      type: 'image_generate',
      inputFileIds: [],
      inputConfig: {
        mode: 'text_to_image',
        prompt: 'a shiba inu',
        size: '1024x1024',
        quality: 'high',
      },
    });
  });

  it('surfaces the daily quota error without creating more tasks', async () => {
    mocks.createTask.mockRejectedValue({
      code: 'AI_IMAGE_DAILY_LIMIT_EXCEEDED',
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(
        screen.getByText("You have used today's quota. Try again tomorrow.")
      ).toBeInTheDocument()
    );
  });

  it('renders a failure panel when status polling keeps erroring instead of spinning forever', async () => {
    // 某项任务永久失败(如 404)会让 useTaskGroupProgress 的 Promise.all 持续 reject,
    // settled 永不为 true。页面必须消费 query.isError,渲染失败提示而非停留在处理中。
    mocks.groupProgress.mockReturnValue({
      items: [],
      completedCount: 0,
      failedCount: 0,
      settled: false,
      query: { isError: true },
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(
        screen.getByText('Generation failed. Please try again.')
      ).toBeInTheDocument()
    );
    // 没有停留在处理中:进度条按钮不应显示 Generating,而是回到可重试状态。
    expect(screen.queryByText('Generating')).not.toBeInTheDocument();
  });

  // __NEW_TESTS__

  it('fills the prompt field when a preset template is chosen from the dialog', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Prompt templates' }));
    // 弹窗打开后,模板按钮出现在 tab 序列里。
    const presetButton = await screen.findByRole('button', {
      name: /Guided science picture book/,
    });
    fireEvent.click(presetButton);

    // 选中模板后提示词被填入,弹窗随之关闭。
    await waitFor(() =>
      expect(screen.getByLabelText('Prompt')).toHaveValue(
        en.ImageGenerate.presets.sciencePictureBook.prompt
      )
    );
    expect(
      screen.queryByRole('button', { name: /Guided science picture book/ })
    ).not.toBeInTheDocument();
  });

  it('shows the example image for each preset that ships one', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Prompt templates' }));
    // 配了示例图的分类在卡片顶部渲染缩略图;alt 文案为 "{title} example"。
    const expected = [
      ['sciencePictureBook', '/presets/science-picture-book.jpg'],
      ['marketStallProposal', '/presets/market-stall-proposal.jpg'],
      ['twitterArticleCover', '/presets/twitter-article-cover.jpg'],
      ['xiaohongshuCover', '/presets/xiaohongshu-cover.jpg'],
      ['wechatArticleCover', '/presets/wechat-article-cover.jpg'],
      ['ecommerceProduct', '/presets/ecommerce-product.jpg'],
    ] as const;
    for (const [id, src] of expected) {
      const alt = en.ImageGenerate.presetExampleAlt.replace(
        '{title}',
        en.ImageGenerate.presets[id].title
      );
      // eslint-disable-next-line no-await-in-loop
      const img = await screen.findByAltText(alt);
      expect(img).toHaveAttribute('src', src);
    }
  });

  it('renders a result preview and download link once a task completes', async () => {
    mocks.groupProgress.mockReturnValue({
      items: [
        {
          taskId: 't1',
          status: 'completed',
          progress: 100,
          outputFileId: 'f1',
        },
      ],
      completedCount: 1,
      failedCount: 0,
      settled: true,
      query: { isError: false },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['img'], { type: 'image/png' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    // mock 的 hook 不会自己调 onItemCompleted,这里手动驱动完成回调走通预览路径。
    await act(async () => {
      await mocks.onItemCompleted('t1', 'f1');
    });

    const img = await screen.findByAltText('Image 1');
    expect(img.getAttribute('src')).toBe('blob:preview-url');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      'blob:preview-url'
    );
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
  // __NEW_TESTS_2__

  it('keeps every preview URL alive while multiple tasks complete', async () => {
    mocks.groupProgress.mockReturnValue({
      items: [
        {
          taskId: 't1',
          status: 'completed',
          progress: 100,
          outputFileId: 'f1',
        },
        {
          taskId: 't2',
          status: 'completed',
          progress: 100,
          outputFileId: 'f2',
        },
      ],
      completedCount: 2,
      failedCount: 0,
      settled: true,
      query: { isError: false },
    });
    let counter = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => `blob:preview-${(counter += 1)}`),
      configurable: true,
      writable: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['img'], { type: 'image/png' })),
      })
    );

    renderPage();

    // 两张图分别在不同的轮询 tick 完成。
    await act(async () => {
      await mocks.onItemCompleted('t1', 'f1');
    });
    await act(async () => {
      await mocks.onItemCompleted('t2', 'f2');
    });

    // 两张预览都渲染,且 URL 各自有效:第二张完成时不得 revoke 第一张仍在展示的 URL。
    expect(await screen.findByAltText('Image 1')).toHaveAttribute(
      'src',
      'blob:preview-1'
    );
    expect(screen.getByAltText('Image 2')).toHaveAttribute(
      'src',
      'blob:preview-2'
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
  // __NEW_TESTS_3__

  it('includes the chosen style in the task input config', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Photographic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalled());
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        inputConfig: expect.objectContaining({ style: 'photographic' }),
      })
    );
  });

  it('offers no upload target while text-to-image is selected', () => {
    const { container } = renderPage();

    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('previews the reference image after it is selected', async () => {
    const { container } = renderPage();

    await chooseReference(container);

    const preview = await screen.findByAltText('Reference image preview');
    expect(preview.getAttribute('src')).toBe('blob:preview-url');
  });

  it('keeps submit disabled for image-to-image until a reference image is chosen', () => {
    renderPage();

    fireEvent.click(screen.getByRole('radio', { name: 'Image to image' }));
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'turn the background into a beach' },
    });

    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('uploads the reference once and reuses its file id for every image', async () => {
    const { container } = renderPage();

    await chooseReference(container);
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'turn the background into a beach' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(2));
    // 一张参考图只上传一次,N 个任务共用同一个 fileId。
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);
    expect(mocks.createTask).toHaveBeenCalledWith({
      type: 'image_generate',
      inputFileIds: ['file-9'],
      inputConfig: {
        mode: 'image_to_image',
        prompt: 'turn the background into a beach',
        size: '1024x1024',
        quality: 'high',
      },
    });
  });

  it('surfaces an upload failure without creating tasks', async () => {
    mocks.uploadFile.mockRejectedValue(new Error('network down'));
    const { container } = renderPage();

    await chooseReference(container);
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'turn the background into a beach' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          'Uploading the reference image failed. Please try again.'
        )
      ).toBeInTheDocument()
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('drops the reference image when switching back to text-to-image', async () => {
    const { container } = renderPage();

    await chooseReference(container);
    await screen.findByAltText('Reference image preview');

    fireEvent.click(screen.getByRole('radio', { name: 'Text to image' }));

    expect(
      screen.queryByAltText('Reference image preview')
    ).not.toBeInTheDocument();
  });

  // 文生图没有上传环节,步骤条不该给它挂一个永远走不到的第一步。
  it('hides the upload step for text-to-image and shows it for image-to-image', async () => {
    const { container } = renderPage();

    expect(screen.queryByText('Upload')).not.toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();

    await chooseReference(container);

    expect(screen.getByText('Upload')).toBeInTheDocument();
  });

  // 信任条第四格是「恢复方式」,常态显示「生成失败」会被当成当前状态。
  it('describes recovery neutrally instead of announcing a failure', () => {
    renderPage();

    expect(
      screen.getByText(/failed generations do not use up your daily quota/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Generation failed. Please try again.')
    ).not.toBeInTheDocument();
  });

  it('shows the remaining daily quota for a signed-in user', () => {
    renderPage();

    expect(screen.getByText('7 / 10 remaining today')).toBeInTheDocument();
  });

  it('hides the remaining quota line for an anonymous visitor', () => {
    mocks.useSession.mockReturnValue({ data: null });
    renderPage();

    expect(screen.queryByText(/remaining today/i)).not.toBeInTheDocument();
  });

  it('compares the reference against the result for image-to-image', async () => {
    mocks.groupProgress.mockReturnValue({
      items: [
        {
          taskId: 't1',
          status: 'completed',
          progress: 100,
          outputFileId: 'f1',
        },
      ],
      completedCount: 1,
      failedCount: 0,
      settled: true,
      query: { isError: false },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['img'], { type: 'image/png' })),
      })
    );
    const { container } = renderPage();

    await chooseReference(container);
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'turn the background into a beach' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalled());
    await act(async () => {
      await mocks.onItemCompleted('t1', 'f1');
    });

    // 前后对比取代了单张结果图。
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
    expect(screen.queryByAltText('Image 1')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('lays multiple results out in two columns', () => {
    mocks.groupProgress.mockReturnValue({
      items: [
        {
          taskId: 't1',
          status: 'completed',
          progress: 100,
          outputFileId: 'f1',
        },
        {
          taskId: 't2',
          status: 'completed',
          progress: 100,
          outputFileId: 'f2',
        },
      ],
      completedCount: 2,
      failedCount: 0,
      settled: true,
      query: { isError: false },
    });
    const { container } = renderPage();

    expect(container.querySelector('.sm\\:grid-cols-2')).not.toBeNull();
  });

  it('hides the source selector when only one provider is configured', () => {
    renderPage();

    expect(screen.queryByText('Source')).toBeNull();
  });

  it('sends the chosen provider id in the task input config', async () => {
    mocks.imageGenerateProviders.mockReturnValue({
      data: [
        { id: 'openai', label: 'OpenAI', capabilities: ['generate', 'edit'] },
        { id: 'kmage', label: 'KMage', capabilities: ['generate', 'edit'] },
      ],
    });
    renderPage();

    fireEvent.click(screen.getByRole('radio', { name: 'KMage' }));
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalled());
    expect(mocks.createTask.mock.calls[0][0].inputConfig).toMatchObject({
      providerId: 'kmage',
    });
  });

  it('omits providerId while the default source is selected', async () => {
    mocks.imageGenerateProviders.mockReturnValue({
      data: [
        { id: 'openai', label: 'OpenAI', capabilities: ['generate', 'edit'] },
        { id: 'kmage', label: 'KMage', capabilities: ['generate', 'edit'] },
      ],
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a shiba inu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalled());
    expect(mocks.createTask.mock.calls[0][0].inputConfig).not.toHaveProperty(
      'providerId'
    );
  });

  it('disables image-to-image when the selected source cannot edit', () => {
    mocks.imageGenerateProviders.mockReturnValue({
      data: [
        { id: 'textonly', label: 'Text only', capabilities: ['generate'] },
      ],
    });
    renderPage();

    expect(
      screen.getByRole('radio', { name: 'Image to image' })
    ).toBeDisabled();
    expect(
      screen.getByText(
        'The selected source does not support image to image. Pick another source.'
      )
    ).toBeInTheDocument();
  });

  it('falls back to text-to-image when switching to a source without edit support', async () => {
    mocks.imageGenerateProviders.mockReturnValue({
      data: [
        { id: 'openai', label: 'OpenAI', capabilities: ['generate', 'edit'] },
        { id: 'textonly', label: 'Text only', capabilities: ['generate'] },
      ],
    });
    const { container } = renderPage();

    await chooseReference(container);
    fireEvent.click(screen.getByRole('radio', { name: 'Text only' }));

    expect(screen.getByRole('radio', { name: 'Text to image' })).toBeChecked();
    // 参考图必须一起丢掉:留着它会攒出「文生图 + inputFileIds」这种服务端必拒的组合。
    expect(screen.queryByAltText('Reference image preview')).toBeNull();
  });

  it('still renders when the provider list request fails', () => {
    mocks.imageGenerateProviders.mockReturnValue({
      data: undefined,
      isError: true,
    });
    renderPage();

    expect(screen.queryByText('Source')).toBeNull();
    expect(
      screen.getByRole('radio', { name: 'Image to image' })
    ).not.toBeDisabled();
  });
});
