import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';

const mocks = vi.hoisted(() => ({
  downloadStoredFile: vi.fn(),
}));

vi.mock('@/lib/files/file-download', () => ({
  downloadStoredFile: mocks.downloadStoredFile,
}));

describe('StoredFileDownloadButton', () => {
  it('requests an attachment download from the stored file endpoint', async () => {
    const { StoredFileDownloadButton } =
      await import('@/components/tools/stored-download-button');

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <StoredFileDownloadButton fileId="file-1" filename="split-plan.zip" />
      </NextIntlClientProvider>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Download split-plan.zip' })
    );

    expect(mocks.downloadStoredFile).toHaveBeenCalledWith(
      'file-1',
      'split-plan.zip'
    );
  });
});
