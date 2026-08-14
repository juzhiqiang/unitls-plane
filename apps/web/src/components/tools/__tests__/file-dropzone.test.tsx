import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import zh from '../../../../messages/zh.json';
import { FileDropzone } from '../file-dropzone';

function renderDropzone({
  locale = 'en',
  maxSize = 50 * 1024 * 1024,
}: {
  locale?: 'en' | 'zh';
  maxSize?: number;
} = {}) {
  const result = render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'zh' ? zh : en}
    >
      <FileDropzone
        accept={{ 'image/*': ['.jpg', '.png'] }}
        maxSize={maxSize}
        multiple
        onDrop={vi.fn()}
        hint="JPG / PNG"
        processingLabel="Local first"
      />
    </NextIntlClientProvider>
  );

  return result.container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
}

describe('FileDropzone', () => {
  it('shows accepted formats, max size, and processing location as stable metadata', () => {
    renderDropzone();

    expect(screen.getByText('JPG / PNG')).toBeInTheDocument();
    expect(screen.getByText('50 MB max')).toBeInTheDocument();
    expect(screen.getByText('Local first')).toBeInTheDocument();
  });

  it('can render as a compact import control', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <FileDropzone onDrop={vi.fn()} hint="MD" density="compact" />
      </NextIntlClientProvider>
    );

    const dropzone = screen.getByText('Click or drag files here').parentElement;
    expect(dropzone).toHaveClass('py-5');
    expect(dropzone).toHaveClass('sm:flex-row');
    expect(dropzone).not.toHaveClass('flex-row');
  });

  it('shows a localized English error when a file is too large', async () => {
    const input = renderDropzone({ maxSize: 1024 });
    const file = new File([new Uint8Array(1025)], 'large.png', {
      type: 'image/png',
    });

    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText('large.png: File must be 1 KB or smaller')
    ).toBeInTheDocument();
    expect(screen.queryByText(/File is larger than/)).not.toBeInTheDocument();
  });

  it('shows a localized Chinese error when a file is too large', async () => {
    const input = renderDropzone({ locale: 'zh', maxSize: 1024 });
    const file = new File([new Uint8Array(1025)], 'large.png', {
      type: 'image/png',
    });

    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText('large.png: 文件不能超过 1 KB')
    ).toBeInTheDocument();
    expect(screen.queryByText(/File is larger than/)).not.toBeInTheDocument();
  });
});
