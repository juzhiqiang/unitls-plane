import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { SettingsPanel } from '@/components/tools/image-generate/settings-panel';
import type { ImageGenerateChatDraft } from '@/components/tools/image-generate/types';
import type {
  ImageGenerateModelDto,
  ImageGeneratePresetDto,
} from '@/hooks/api/types';

const MODELS: ImageGenerateModelDto[] = [
  {
    model: 'gpt-image-1',
    capabilities: ['generate', 'edit'],
    sizes: ['auto', '1024x1024', '1024x1536', '1536x1024', '1536x864'],
    customSizes: false,
  },
];

const FLEXIBLE_MODELS: ImageGenerateModelDto[] = [
  { ...MODELS[0]!, customSizes: true },
];

const PRESETS: ImageGeneratePresetDto[] = [
  {
    id: 'preset-uuid-1',
    title: 'Guided science picture book',
    prompt: 'Create a guided science picture book illustration.',
    sortOrder: 0,
  },
];

const DRAFT: ImageGenerateChatDraft = {
  prompt: '',
  size: 'auto',
  quality: 'auto',
  count: 1,
};

/** 用真实 useState 包一层:面板是受控组件,应用/选中后的效果要看下一次渲染。 */
function Harness({
  models = MODELS,
  presets = PRESETS,
  onPickPreset,
  initial = DRAFT,
}: {
  models?: ImageGenerateModelDto[];
  presets?: ImageGeneratePresetDto[];
  onPickPreset?: (prompt: string) => void;
  initial?: ImageGenerateChatDraft;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale="en" messages={en as never}>
      <SettingsPanel
        value={value}
        onChange={setValue}
        models={models}
        presets={presets}
        onPickPreset={onPickPreset}
      />
      <output data-testid="draft-size">{value.size}</output>
    </NextIntlClientProvider>
  );
}

function draftSize() {
  return screen.getByTestId('draft-size').textContent;
}

describe('SettingsPanel custom aspect ratio', () => {
  it('disables the custom chip with a hint when the model does not declare customSizes', () => {
    render(<Harness />);

    const chip = screen.getByRole('button', { name: 'Custom' });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute(
      'title',
      'The selected model does not support custom ratios'
    );
  });

  it('applies a ratio with a matching chip to that chip size', () => {
    render(<Harness models={FLEXIBLE_MODELS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom aspect ratio'), {
      target: { value: '16:9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(draftSize()).toBe('1536x864');
    // 输入框保留用户输入,并展示实际提交值。
    expect(screen.getByLabelText('Custom aspect ratio')).toHaveValue('16:9');
    expect(screen.getByText('Submitting: 1536x864')).toBeInTheDocument();
  });

  it('synthesizes and submits a size for a ratio with no matching chip', () => {
    render(<Harness models={FLEXIBLE_MODELS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom aspect ratio'), {
      target: { value: '21:9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(draftSize()).toBe('1536x656');
    expect(screen.getByText('Submitting: 1536x656')).toBeInTheDocument();
  });

  it('shows an error and keeps the draft untouched for invalid input', () => {
    render(<Harness models={FLEXIBLE_MODELS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom aspect ratio'), {
      target: { value: '1x1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter W:H or WxH (16–4096)'
    );
    expect(draftSize()).toBe('auto');
  });

  it('clears back to auto from the custom input area', () => {
    render(
      <Harness
        models={FLEXIBLE_MODELS}
        initial={{ ...DRAFT, size: '1536x656' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear custom ratio' }));

    expect(draftSize()).toBe('auto');
    expect(screen.queryByLabelText('Custom aspect ratio')).toBeNull();
  });

  it('selecting a chip closes the custom input area', () => {
    render(<Harness models={FLEXIBLE_MODELS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByLabelText('Custom aspect ratio')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('3:2'));

    expect(screen.queryByLabelText('Custom aspect ratio')).toBeNull();
    expect(draftSize()).toBe('1536x1024');
  });
});

describe('SettingsPanel preset entry', () => {
  it('opens the shared picker and fills the prompt without closing the panel', () => {
    const onPickPreset = vi.fn();
    render(<Harness onPickPreset={onPickPreset} />);

    expect(screen.getByText('Prompt templates')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose a prompt template' })
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Guided science picture book/ })
    );

    expect(onPickPreset).toHaveBeenCalledWith(
      'Create a guided science picture book illustration.'
    );
    // 弹窗关闭,设置面板本体仍在。
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Aspect ratio')).toBeInTheDocument();
  });

  it('hides the preset row when no presets are configured', () => {
    render(<Harness presets={[]} onPickPreset={vi.fn()} />);

    expect(screen.queryByText('Prompt templates')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Choose a prompt template' })
    ).toBeNull();
  });
});
