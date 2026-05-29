import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { FileList } from '../file-list';
import en from '../../../../messages/en.json';

function renderFileList(result?: File) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <FileList
        items={[
          {
            file: new File(['a'.repeat(2048)], 'source.png', {
              type: 'image/png',
            }),
            result,
            status: 'done',
          },
        ]}
      />
    </NextIntlClientProvider>
  );
}

describe('FileList', () => {
  it('does not render mojibake for the dash placeholder', () => {
    renderFileList();

    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('鈥');
  });

  it('does not render mojibake for the arrow between file sizes', () => {
    renderFileList(new File(['a'.repeat(1024)], 'result.png'));

    expect(document.body.textContent).toContain('→');
    expect(document.body.textContent).not.toContain('鈫');
  });
});
