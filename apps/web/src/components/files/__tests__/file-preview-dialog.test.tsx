import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { FilePreviewDialog } from '../file-preview-dialog';

vi.mock('@/components/tools/pdf-result-preview', () => ({
  PdfResultPreview: ({ file, label }: { file: File; label: string }) => (
    <div data-testid="pdf-preview">
      {label} / {file.name} / {file.type}
    </div>
  ),
}));

const API_URL = 'https://api.example.com';
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

function renderDialog(props: Parameters<typeof FilePreviewDialog>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en as never}>
      <FilePreviewDialog {...props} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = API_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

describe('FilePreviewDialog', () => {
  it('previews an image with the inline url, not the attachment url', () => {
    renderDialog({
      open: true,
      onClose: () => {},
      file: {
        id: 'file-1',
        filename: 'shot.png',
        mimeType: 'image/png',
        originalSize: 2048,
      },
    });

    const image = screen.getByAltText('shot.png');
    expect(image.getAttribute('src')).toBe(`${API_URL}/files/file-1/download`);
    expect(screen.getByTitle('Open in new tab').getAttribute('href')).toBe(
      `${API_URL}/files/file-1/download`
    );
  });

  it('fetches the pdf with credentials and hands it to the pdf preview', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Blob(['%PDF-1.7']), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderDialog({
      open: true,
      onClose: () => {},
      file: {
        id: 'file-2',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        originalSize: 4096,
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId('pdf-preview')).toBeInTheDocument()
    );
    expect(screen.getByTestId('pdf-preview').textContent).toContain(
      'report.pdf'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/files/file-2/download`,
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('tells the user to download unsupported types', () => {
    renderDialog({
      open: true,
      onClose: () => {},
      file: {
        id: 'file-3',
        filename: 'Inter.woff2',
        mimeType: 'font/woff2',
        originalSize: 1024,
      },
    });

    expect(
      screen.getByText(en.FilesTool.previewUnsupported)
    ).toBeInTheDocument();
  });

  it('refuses to preview oversized files', () => {
    renderDialog({
      open: true,
      onClose: () => {},
      file: {
        id: 'file-4',
        filename: 'huge.png',
        mimeType: 'image/png',
        originalSize: 80 * 1024 * 1024,
      },
    });

    expect(screen.getByText(en.FilesTool.previewTooLarge)).toBeInTheDocument();
  });

  it('reports missing files', () => {
    renderDialog({
      open: true,
      onClose: () => {},
      file: null,
      isMissing: true,
    });

    expect(screen.getByText(en.FilesTool.previewMissing)).toBeInTheDocument();
  });
});
