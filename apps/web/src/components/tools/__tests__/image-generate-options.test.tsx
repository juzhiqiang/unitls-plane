import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_GENERATE_PROMPT_MAX_LENGTH } from '@utils-plane/validators';
import en from '../../../../messages/en.json';
import {
  ImageGenerateModeField,
  ImageGenerateParamsFields,
  ImageGeneratePromptField,
  type ImageGenerateDraft,
} from '../image-generate-options';

/**
 * 提示词模板由页面从 GET /tasks/image-generate/presets 拉取后作为 prop 传入
 * （与 providers 同模式），组件自己不再持有硬编码模板。
 */
const presets = [
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

const draft: ImageGenerateDraft = {
  mode: 'text_to_image',
  prompt: '',
  size: '1024x1024',
  quality: 'high',
  count: 1,
};

// 仓库未安装 @testing-library/user-event(见 apps/web/package.json),既有交互
// 测试统一用 fireEvent,这里保持一致:受控组件下 change/click 与真实交互等价。
// en.json 的真实结构与 next-intl 的 AbstractIntlMessages 索引签名不完全兼容
// (存在嵌套数组),用 as never 绕过类型校验;运行时只读取 ImageGenerate 段。
//
// 三个字段组件按页面里的真实顺序一起渲染:它们共享同一个 draft,断言的是整组行为。
beforeEach(() => {
  // 示例图公网 URL 由前端用 NEXT_PUBLIC_S3_PUBLIC_URL 拼,测试里显式给一个 base。
  vi.stubEnv('NEXT_PUBLIC_S3_PUBLIC_URL', 'http://minio.test:9000');
});

function renderOptions(
  value: ImageGenerateDraft = draft,
  onChange = vi.fn(),
  disabled = false,
  presetList = presets
) {
  render(
    <NextIntlClientProvider locale="en" messages={en as never}>
      <ImageGenerateModeField
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <ImageGeneratePromptField
        value={value}
        onChange={onChange}
        disabled={disabled}
        presets={presetList}
      />
      <ImageGenerateParamsFields
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </NextIntlClientProvider>
  );
  return { onChange };
}

describe('ImageGenerateOptions', () => {
  it('renders a labelled prompt field', () => {
    renderOptions();
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
  });

  it('reports prompt edits', () => {
    const { onChange } = renderOptions();

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'a' },
    });

    expect(onChange).toHaveBeenCalledWith({ ...draft, prompt: 'a' });
  });

  // 守卫 spec 契约:prompt 上限必须复用 @utils-plane/validators 的导出常量,
  // 有人改回硬编码 2000 时这条会失败。
  it('caps the prompt with the shared validators limit', () => {
    renderOptions();

    expect(screen.getByLabelText('Prompt')).toHaveAttribute(
      'maxlength',
      String(IMAGE_GENERATE_PROMPT_MAX_LENGTH)
    );
  });

  // 计数必须由同一个常量插值,不能在 messages 里写死数字,
  // 否则改上限时中英文文案会静默过期。
  it('counts the typed prompt against the shared limit', () => {
    renderOptions({ ...draft, prompt: 'abcde' });

    expect(
      screen.getByText(`5 / ${IMAGE_GENERATE_PROMPT_MAX_LENGTH}`)
    ).toBeInTheDocument();
  });

  it('links the counter to the textarea for assistive tech', () => {
    renderOptions();

    const counter = screen.getByText(`0 / ${IMAGE_GENERATE_PROMPT_MAX_LENGTH}`);
    expect(screen.getByLabelText('Prompt')).toHaveAttribute(
      'aria-describedby',
      counter.id
    );
  });

  // textarea 是 inline-block:限宽后若 label 不是 block,两者会共用一个 line box、
  // 按基线对齐,标签就跑到输入框底部去了(实测出现过)。
  it('keeps the prompt label on its own line above the textarea', () => {
    renderOptions();

    expect(screen.getByText('Prompt')).toHaveClass('block');
  });

  it('renders the mode switch with text-to-image selected by default', () => {
    renderOptions();

    expect(screen.getByRole('radio', { name: 'Text to image' })).toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Image to image' })
    ).not.toBeChecked();
  });

  it('reports the selected mode', () => {
    const { onChange } = renderOptions();

    fireEvent.click(screen.getByRole('radio', { name: 'Image to image' }));

    expect(onChange).toHaveBeenCalledWith({
      ...draft,
      mode: 'image_to_image',
    });
  });

  it('reports the selected size', () => {
    const { onChange } = renderOptions();

    fireEvent.click(screen.getByRole('radio', { name: 'Portrait 2:3' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, size: '1024x1536' });
  });

  it('reports the selected quality', () => {
    const { onChange } = renderOptions();

    fireEvent.click(screen.getByRole('radio', { name: 'Standard' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, quality: 'standard' });
  });

  it('reports the selected style', () => {
    const { onChange } = renderOptions();

    fireEvent.click(screen.getByRole('radio', { name: 'Anime' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, style: 'anime' });
  });

  it('clears the style when Unspecified is selected', () => {
    const { onChange } = renderOptions({ ...draft, style: 'anime' });

    fireEvent.click(screen.getByRole('radio', { name: 'Unspecified' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, style: undefined });
  });

  it('reports the requested image count', () => {
    const { onChange } = renderOptions();

    fireEvent.click(screen.getByRole('radio', { name: '4' }));

    expect(onChange).toHaveBeenCalledWith({ ...draft, count: 4 });
  });

  // 模板内容与示例图都来自 API:标题/提示词直接渲染,示例图 key 拼成 MinIO 公网 URL。
  it('renders the API-provided presets in the dialog', async () => {
    renderOptions();

    fireEvent.click(screen.getByRole('button', { name: 'Prompt templates' }));

    const img = await screen.findByAltText(
      'Guided science picture book example'
    );
    expect(img).toHaveAttribute(
      'src',
      'http://minio.test:9000/presets/science-picture-book.jpg'
    );
    // 没配 imageStorageKey 的模板退化成纯文本卡片。
    expect(
      screen.queryByAltText('Mind map & knowledge graph example')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Mind map & knowledge graph/ })
    ).toBeInTheDocument();
  });

  it('fills the prompt with the chosen preset', async () => {
    const { onChange } = renderOptions();

    fireEvent.click(screen.getByRole('button', { name: 'Prompt templates' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Guided science picture book/,
      })
    );

    expect(onChange).toHaveBeenCalledWith({
      ...draft,
      prompt: presets[0]!.prompt,
    });
  });

  // 一条模板都没拉到时不渲染入口:点开一个空弹窗比没有入口更让人困惑。
  it('hides the preset trigger when no presets are available', () => {
    renderOptions(draft, vi.fn(), false, []);

    expect(
      screen.queryByRole('button', { name: 'Prompt templates' })
    ).not.toBeInTheDocument();
  });

  it('disables every control while a generation is running', () => {
    renderOptions(draft, vi.fn(), true);

    expect(screen.getByLabelText('Prompt')).toBeDisabled();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });
});
