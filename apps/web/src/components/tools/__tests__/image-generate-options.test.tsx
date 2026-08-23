import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { IMAGE_GENERATE_PROMPT_MAX_LENGTH } from '@utils-plane/validators';
import en from '../../../../messages/en.json';
import {
  ImageGenerateOptions,
  type ImageGenerateDraft,
} from '../image-generate-options';

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
function renderOptions(
  value: ImageGenerateDraft = draft,
  onChange = vi.fn(),
  disabled = false
) {
  render(
    <NextIntlClientProvider locale="en" messages={en as never}>
      <ImageGenerateOptions
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

  // 提示文案里的字数必须由同一个常量插值,不能在 messages 里写死数字,
  // 否则改上限时中英文文案会静默过期。
  it('states the shared limit in the prompt hint', () => {
    renderOptions();

    expect(
      screen.getByText(`Up to ${IMAGE_GENERATE_PROMPT_MAX_LENGTH} characters`)
    ).toBeInTheDocument();
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

  it('disables every control while a generation is running', () => {
    renderOptions(draft, vi.fn(), true);

    expect(screen.getByLabelText('Prompt')).toBeDisabled();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });
});
