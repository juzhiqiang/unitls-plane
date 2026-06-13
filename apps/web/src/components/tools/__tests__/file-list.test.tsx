import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { FileList } from '../file-list';
import en from '../../../../messages/en.json';

function renderFileList(result?: File, onRemove?: (index: number) => void) {
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
        onRemove={onRemove}
      />
    </NextIntlClientProvider>
  );
}

describe('FileList', () => {
  it('renders an ASCII dash placeholder', () => {
    renderFileList();

    expect(screen.getAllByText('-')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('\uFFFD');
  });

  it('renders an ASCII arrow between file sizes', () => {
    renderFileList(new File(['a'.repeat(1024)], 'result.png'));

    expect(document.body.textContent).toContain('->');
    expect(document.body.textContent).not.toContain('\uFFFD');
  });

  it('labels remove buttons with the source filename', () => {
    renderFileList(undefined, () => undefined);

    expect(
      screen.getAllByRole('button', { name: 'Remove source.png' })
    ).toHaveLength(2);
  });
});
