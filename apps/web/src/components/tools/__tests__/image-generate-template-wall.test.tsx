import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { ImageGenerateTemplateWall } from '../image-generate-template-wall';

const PRESETS = [
  {
    id: 'preset-1',
    title: 'Guided science picture book',
    prompt: 'Create a high-finish guided science picture book illustration.',
    imageStorageKey: 'science-picture-book.jpg',
    sortOrder: 0,
  },
  {
    id: 'preset-2',
    title: 'Mind map & knowledge graph',
    prompt: 'Generate a mind-map infographic, educational-poster style.',
    sortOrder: 1,
  },
];

function renderWall(presets = PRESETS, disabled = false) {
  const onPick = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ImageGenerateTemplateWall
        presets={presets}
        disabled={disabled}
        onPick={onPick}
      />
    </NextIntlClientProvider>
  );
  return onPick;
}

describe('ImageGenerateTemplateWall', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_S3_PUBLIC_URL', 'http://minio.test:9000');
  });

  it('renders the wall title and one button card per preset', () => {
    renderWall();

    expect(screen.getByText('Idea templates')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Guided science picture book/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Mind map & knowledge graph/ })
    ).toBeInTheDocument();
  });

  it('fills the prompt through onPick when a card is clicked', () => {
    const onPick = renderWall();

    fireEvent.click(
      screen.getByRole('button', { name: /Guided science picture book/ })
    );

    expect(onPick).toHaveBeenCalledWith(PRESETS[0]!.prompt);
  });

  it('renders the MinIO example image for presets that ship one', () => {
    renderWall();

    const alt = en.ImageGenerate.presetExampleAlt.replace(
      '{title}',
      PRESETS[0]!.title
    );
    expect(screen.getByAltText(alt)).toHaveAttribute(
      'src',
      'http://minio.test:9000/presets/science-picture-book.jpg'
    );
  });

  it('degrades to a plain hint when no presets are available', () => {
    renderWall([]);

    expect(screen.getByText('Describe your prompt on the left to start creating.')).toBeInTheDocument();
    expect(screen.queryByText('Idea templates')).not.toBeInTheDocument();
  });

  it('disables every card while busy', () => {
    renderWall(PRESETS, true);

    expect(
      screen.getByRole('button', { name: /Guided science picture book/ })
    ).toBeDisabled();
  });
});
