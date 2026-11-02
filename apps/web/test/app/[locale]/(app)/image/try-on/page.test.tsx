import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../../messages/en.json';
import zh from '../../../../../../messages/zh.json';
import ImageTryOnPage from '@/app/[locale]/(app)/image/try-on/page';
import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceKind,
} from '@/hooks/api/types';

const PERSON_UUID = '00000000-0000-4000-8000-000000000001';
const GARMENT_UUID_1 = '00000000-0000-4000-8000-000000000002';
const GARMENT_UUID_2 = '00000000-0000-4000-8000-000000000003';
const POSE_UUID = '00000000-0000-4000-8000-000000000004';

const PERSON_ASSETS: AiTryOnReferenceAssetDto[] = [
  {
    id: PERSON_UUID,
    kind: 'person',
    title: 'Studio model A',
    description: 'Neutral standing portrait',
    tags: ['studio', 'full-body'],
    thumbnailUrl: 'https://cdn.example.test/person-a.webp',
    sourceUrl: 'https://source.example.test/person-a',
    licenseName: 'CC0 1.0',
    attribution: 'Utils Plane Studio',
  },
];

const GARMENT_ASSETS: AiTryOnReferenceAssetDto[] = [
  {
    id: GARMENT_UUID_1,
    kind: 'garment',
    title: 'Tailored wool coat',
    description: 'Camel double-breasted coat',
    tags: ['coat', 'autumn'],
    thumbnailUrl: 'https://cdn.example.test/garment-1.webp',
    sourceUrl: 'https://source.example.test/garment-1',
    licenseName: 'CC BY 4.0',
    attribution: 'Atelier Archive',
  },
  {
    id: GARMENT_UUID_2,
    kind: 'garment',
    title: 'Minimalist trench look',
    description: 'Editorial styling reference',
    tags: ['street', 'editorial'],
    thumbnailUrl: 'https://cdn.example.test/garment-2.webp',
    sourceUrl: 'https://source.example.test/garment-2',
    licenseName: 'CC0 1.0',
    attribution: 'Utils Plane Studio',
  },
];

const POSE_ASSETS: AiTryOnReferenceAssetDto[] = [
  {
    id: POSE_UUID,
    kind: 'pose',
    title: 'Three-quarter turn',
    description: 'Relaxed e-commerce lookbook pose',
    tags: ['lookbook'],
    thumbnailUrl: 'https://cdn.example.test/pose-1.webp',
    sourceUrl: 'https://source.example.test/pose-1',
    licenseName: 'CC0 1.0',
    attribution: 'Utils Plane Studio',
  },
];

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  createTask: vi.fn(),
  uploadFile: vi.fn(),
  retryTask: vi.fn(),
  imageGenerateQuota: vi.fn(),
  imageGenerateModels: vi.fn(),
  aiTryOnReferences: vi.fn(),
  taskProgress: vi.fn(),
  downloadStoredFile: vi.fn(),
  invalidate: vi.fn(),
  push: vi.fn(),
  maxFileSize: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
  useRouter: () => ({ push: mocks.push }),
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
  useRetryTask: () => ({ mutate: mocks.retryTask, isPending: false }),
  useImageGenerateQuota: () => mocks.imageGenerateQuota(),
  useImageGenerateModels: () => mocks.imageGenerateModels(),
}));

vi.mock('@/hooks/api/use-ai-try-on', () => ({
  useAiTryOnReferences: (kind: AiTryOnReferenceKind) =>
    mocks.aiTryOnReferences(kind),
}));

vi.mock('@/hooks/api/use-files', () => ({
  useUploadFile: () => ({ mutateAsync: mocks.uploadFile }),
}));

vi.mock('@/hooks/api/use-task-progress', () => ({
  useTaskProgress: (taskId: string | null) => mocks.taskProgress(taskId),
}));

vi.mock('@/hooks/use-object-url', () => ({
  useObjectUrl: (file: File | null) => (file ? `blob:${file.name}` : undefined),
}));

vi.mock('@/lib/tools/image-limits', () => ({
  getImageUploadMaxFileSize: () => mocks.maxFileSize(),
}));

vi.mock('@/lib/files/file-download', () => ({
  buildFileDownloadUrl: (fileId: string) =>
    `http://api.test:3001/files/${fileId}/download`,
  downloadStoredFile: (fileId: string) => mocks.downloadStoredFile(fileId),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));

function renderTryOnPage(locale: 'en' | 'zh' = 'en') {
  const messages = (locale === 'zh'
    ? zh
    : en) as unknown as AbstractIntlMessages;
  const view = render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ImageTryOnPage />
    </NextIntlClientProvider>
  );
  const rerender = () =>
    view.rerender(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ImageTryOnPage />
      </NextIntlClientProvider>
    );
  return { ...view, rerender };
}

function makeFile(name: string, bytes = 16) {
  return new File(['x'.repeat(bytes)], name, { type: 'image/png' });
}

beforeEach(() => {
  vi.clearAllMocks();
  let uploadSeq = 0;
  mocks.useSession.mockReturnValue({ data: { user: { id: 'user-1' } } });
  mocks.uploadFile.mockImplementation(async () => {
    uploadSeq += 1;
    return { id: `uploaded-file-${uploadSeq}` };
  });
  mocks.createTask.mockResolvedValue({
    id: 'try-on-task-1',
    status: 'pending',
    progress: 0,
  });
  mocks.imageGenerateQuota.mockReturnValue({
    data: { limit: 10, used: 2, remaining: 8 },
    isError: false,
  });
  mocks.imageGenerateModels.mockReturnValue({
    data: [
      {
        model: 'gpt-image-1',
        capabilities: ['generate', 'edit'],
        sizes: ['auto', '1024x1024', '1024x1536', '1536x1024'],
        customSizes: false,
      },
    ],
  });
  mocks.aiTryOnReferences.mockImplementation((kind: AiTryOnReferenceKind) => {
    if (kind === 'person') {
      return { data: PERSON_ASSETS, isLoading: false, isError: false };
    }
    if (kind === 'garment') {
      return { data: GARMENT_ASSETS, isLoading: false, isError: false };
    }
    return { data: POSE_ASSETS, isLoading: false, isError: false };
  });
  mocks.taskProgress.mockReturnValue({ data: undefined });
  mocks.maxFileSize.mockReturnValue(10 * 1024 * 1024);
});

describe('ImageTryOnPage', () => {
  it('renders both product and inspiration modes and gates the submit button until person and garment are provided', () => {
    renderTryOnPage('en');

    expect(
      screen.getByRole('heading', { name: 'AI e-commerce try-on' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('try-on-quota-badge')).toHaveTextContent(
      '8 / 10 remaining today (shared with AI image generation)'
    );

    const submitButton = screen.getByTestId('try-on-submit');
    expect(submitButton).toBeDisabled();

    // Upload person only -> still disabled because product garment is missing
    fireEvent.change(screen.getByTestId('upload-input-person'), {
      target: { files: [makeFile('person.png')] },
    });
    expect(submitButton).toBeDisabled();

    // Upload product garment -> enabled in product mode
    fireEvent.change(screen.getByTestId('upload-input-garment'), {
      target: { files: [makeFile('product.png')] },
    });
    expect(submitButton).toBeEnabled();

    // Switch to inspiration mode -> disabled until a library garment is chosen
    fireEvent.click(screen.getByTestId('mode-inspiration'));
    expect(submitButton).toBeDisabled();

    // Pick inspiration garment from library -> enabled again
    fireEvent.click(
      screen.getByTestId(`library-item-garment-${GARMENT_UUID_1}`)
    );
    expect(submitButton).toBeEnabled();
  });

  it('submits product mode with two uploaded files, deduplicating unused uploads and mapping 0-based inputIndex', async () => {
    renderTryOnPage('en');

    // First attach an initial person file, then replace it to prove old uploads are not leaked
    fireEvent.change(screen.getByTestId('upload-input-person'), {
      target: { files: [makeFile('old-person.png')] },
    });
    fireEvent.click(screen.getByTestId('remove-upload-person'));
    fireEvent.change(screen.getByTestId('upload-input-person'), {
      target: { files: [makeFile('final-person.png')] },
    });
    fireEvent.change(screen.getByTestId('upload-input-garment'), {
      target: { files: [makeFile('product-coat.png')] },
    });

    fireEvent.click(screen.getByTestId('try-on-submit'));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.uploadFile).toHaveBeenCalledTimes(2);
    expect(mocks.createTask).toHaveBeenCalledWith({
      type: 'image_try_on',
      inputFileIds: ['uploaded-file-1', 'uploaded-file-2'],
      inputConfig: {
        mode: 'product',
        references: [
          { role: 'person', source: 'upload', inputIndex: 0 },
          { role: 'garment', source: 'upload', inputIndex: 1 },
        ],
        size: '1024x1024',
        quality: 'high',
      },
    });
  });

  it('maps garment upload to inputIndex 0 when person is selected from the library and supports all 4 reference roles', async () => {
    renderTryOnPage('en');

    // Switch person to library and pick a model
    fireEvent.click(screen.getByTestId('person-source-library'));
    fireEvent.click(screen.getByTestId(`library-item-person-${PERSON_UUID}`));

    // Upload product photo
    fireEvent.change(screen.getByTestId('upload-input-garment'), {
      target: { files: [makeFile('product-dress.png')] },
    });

    // Pick optional pose and optional auxiliary style (up to 4 references)
    fireEvent.click(screen.getByTestId(`library-item-pose-${POSE_UUID}`));
    fireEvent.click(screen.getByTestId(`library-item-style-${GARMENT_UUID_2}`));

    expect(screen.getByTestId('try-on-reference-count')).toHaveTextContent(
      'Selected references: 4 / 4'
    );

    fireEvent.change(screen.getByLabelText('Scene & background notes'), {
      target: { value: 'soft natural studio light' },
    });

    fireEvent.click(screen.getByTestId('try-on-submit'));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.uploadFile).toHaveBeenCalledTimes(1);

    const submitted = mocks.createTask.mock.calls[0]?.[0];
    expect(submitted).toEqual({
      type: 'image_try_on',
      inputFileIds: ['uploaded-file-1'],
      inputConfig: {
        mode: 'product',
        references: [
          { role: 'person', source: 'library', assetId: PERSON_UUID },
          { role: 'garment', source: 'upload', inputIndex: 0 },
          { role: 'pose', source: 'library', assetId: POSE_UUID },
          { role: 'style', source: 'library', assetId: GARMENT_UUID_2 },
        ],
        promptAddition: 'soft natural studio light',
        size: '1024x1024',
        quality: 'high',
      },
    });
    // Library references only send UUIDs, never URLs or storage keys
    expect(JSON.stringify(submitted)).not.toContain('cdn.example.test');
    expect(JSON.stringify(submitted)).not.toContain('source.example.test');
  });

  it('disables submission and shows a translatable alert when shared daily quota is exhausted', () => {
    mocks.imageGenerateQuota.mockReturnValue({
      data: { limit: 10, used: 10, remaining: 0 },
      isError: false,
    });

    renderTryOnPage('en');

    fireEvent.change(screen.getByTestId('upload-input-person'), {
      target: { files: [makeFile('person.png')] },
    });
    fireEvent.change(screen.getByTestId('upload-input-garment'), {
      target: { files: [makeFile('product.png')] },
    });

    expect(screen.getByTestId('try-on-quota-exhausted')).toHaveTextContent(
      "You have used today's shared generation quota. Please try again tomorrow."
    );
    expect(screen.getByTestId('try-on-submit')).toBeDisabled();
  });

  it('supports empty library and library API failure fallback to product upload workflow', async () => {
    mocks.aiTryOnReferences.mockImplementation((kind: AiTryOnReferenceKind) => {
      if (kind === 'garment') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: vi.fn(),
        };
      }
      return { data: [], isLoading: false, isError: false };
    });

    renderTryOnPage('en');

    // Switch to inspiration mode where garment library is required -> shows error and disables submit
    fireEvent.click(screen.getByTestId('mode-inspiration'));
    expect(screen.getByTestId('library-error-garment')).toBeInTheDocument();
    expect(
      screen.getByTestId('try-on-required-library-error')
    ).toHaveTextContent(
      'The reference library required for the current selection failed to load. Retry or switch to upload mode.'
    );
    expect(screen.getByTestId('try-on-submit')).toBeDisabled();

    // Person library is empty -> shows empty state and upload fallback button
    fireEvent.click(screen.getByTestId('person-source-library'));
    expect(screen.getByTestId('library-empty-person')).toHaveTextContent(
      'No licensed reference assets are available in this category yet.'
    );

    // Click fallback action to switch back to product mode + portrait upload
    const fallbackButtons = screen.getAllByRole('button', {
      name: 'Switch to uploading product & portrait',
    });
    fireEvent.click(fallbackButtons[0]!);

    // Now in product mode + upload person: upload both files and submit successfully despite empty/failed libraries
    fireEvent.change(screen.getByTestId('upload-input-person'), {
      target: { files: [makeFile('person.png')] },
    });
    fireEvent.change(screen.getByTestId('upload-input-garment'), {
      target: { files: [makeFile('product.png')] },
    });

    expect(screen.getByTestId('try-on-submit')).toBeEnabled();
    fireEvent.click(screen.getByTestId('try-on-submit'));

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
  });

  it('renders queued, processing, completed result with AI/mode badges, download, and failed retry states', async () => {
    const { rerender } = renderTryOnPage('en');

    fireEvent.click(screen.getByTestId('mode-inspiration'));
    fireEvent.click(screen.getByTestId('person-source-library'));
    fireEvent.click(screen.getByTestId(`library-item-person-${PERSON_UUID}`));
    fireEvent.click(
      screen.getByTestId(`library-item-garment-${GARMENT_UUID_1}`)
    );

    fireEvent.click(screen.getByTestId('try-on-submit'));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));

    // Queued state right after creation
    expect(screen.getAllByText('Queued…').length).toBeGreaterThanOrEqual(1);

    // Processing state
    mocks.taskProgress.mockReturnValue({
      data: {
        status: 'processing',
        progress: 45,
      },
    });
    rerender();
    expect(
      screen.getAllByText('Generating try-on image…').length
    ).toBeGreaterThanOrEqual(1);

    // Completed state: shows AI-generated badge, mode badge, disclaimer, download & regenerate
    mocks.taskProgress.mockReturnValue({
      data: {
        status: 'completed',
        progress: 100,
        outputFileId: 'output-try-on-99',
      },
    });
    rerender();

    expect(screen.getByText('Try-on result ready')).toBeInTheDocument();
    expect(screen.getByTestId('result-ai-badge')).toHaveTextContent(
      'AI-generated visual'
    );
    expect(screen.getByTestId('result-mode-badge')).toHaveTextContent(
      'Styling inspiration'
    );
    expect(
      screen.getByText(
        /This is an AI-generated styling inspiration image created from licensed library garments/
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('try-on-download'));
    expect(mocks.downloadStoredFile).toHaveBeenCalledWith('output-try-on-99');

    // Failed state: shows recovery panel, invalidates quota, and retries on click
    mocks.taskProgress.mockReturnValue({
      data: {
        status: 'failed',
        progress: 0,
        errorCode: 'AI_IMAGE_CONTENT_REJECTED',
      },
    });
    rerender();

    expect(
      screen.getByText(
        'The prompt or reference images were rejected by the content policy. Adjust and try again.'
      )
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.invalidate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: expect.arrayContaining(['image-generate', 'quota']),
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryTask).toHaveBeenCalledWith(
      'try-on-task-1',
      expect.any(Object)
    );
  });

  it('renders localized Chinese copy and product mode result disclaimer in zh locale', async () => {
    mocks.createTask.mockResolvedValue({
      id: 'try-on-zh-1',
      status: 'completed',
      progress: 100,
      outputFileId: 'out-zh-1',
    });

    renderTryOnPage('zh');

    expect(
      screen.getByRole('heading', { name: 'AI 电商试衣' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('mode-product')).toHaveTextContent(
      '真实商品试穿'
    );
    expect(screen.getByTestId('mode-inspiration')).toHaveTextContent(
      '穿搭灵感'
    );
    expect(screen.getByTestId('try-on-quota-badge')).toHaveTextContent(
      '今日剩余 8 / 10 张（与 AI 生图共用）'
    );

    fireEvent.change(screen.getByTestId('upload-input-person'), {
      target: { files: [makeFile('person.png')] },
    });
    fireEvent.change(screen.getByTestId('upload-input-garment'), {
      target: { files: [makeFile('product.png')] },
    });

    fireEvent.click(screen.getByTestId('try-on-submit'));

    await waitFor(() =>
      expect(screen.getByText('试衣结果已生成')).toBeInTheDocument()
    );
    expect(screen.getByTestId('result-ai-badge')).toHaveTextContent(
      'AI 生成展示图'
    );
    expect(screen.getByTestId('result-mode-badge')).toHaveTextContent(
      '真实商品试穿'
    );
    expect(
      screen.getByText(/不承诺 100% 还原商品版型、色差、印花与细节/)
    ).toBeInTheDocument();
  });
});
