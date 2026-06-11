import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { FileDropzone } from '../file-dropzone';

function renderDropzone() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <FileDropzone
        accept={{ 'image/*': ['.jpg', '.png'] }}
        maxSize={50 * 1024 * 1024}
        multiple
        onDrop={vi.fn()}
        hint="JPG / PNG"
        processingLabel="Local first"
      />
    </NextIntlClientProvider>,
  );
}

describe('FileDropzone', () => {
  it('shows accepted formats, max size, and processing location as stable metadata', () => {
    renderDropzone();

    expect(screen.getByText('JPG / PNG')).toBeInTheDocument();
    expect(screen.getByText('50 MB max')).toBeInTheDocument();
    expect(screen.getByText('Local first')).toBeInTheDocument();
  });
});
