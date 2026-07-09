import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import {
  SortableImageList,
  type SortableImageFile,
} from '../sortable-image-list';
import en from '../../../../messages/en.json';

function makeFile(name: string, size: number) {
  return new File(['x'.repeat(size)], name, { type: 'image/png' });
}

const files: SortableImageFile[] = [
  { id: 'a', file: makeFile('first.png', 1024) },
  { id: 'b', file: makeFile('second.png', 2048) },
];

function renderSortableImageList(onRemove = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SortableImageList
        files={files}
        onReorder={vi.fn()}
        onRemove={onRemove}
      />
    </NextIntlClientProvider>
  );
}

describe('SortableImageList', () => {
  it('renders image filenames and one-based order labels', () => {
    renderSortableImageList();

    expect(screen.getByText('first.png')).toBeInTheDocument();
    expect(screen.getByText('second.png')).toBeInTheDocument();
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('02')).toBeInTheDocument();
  });

  it('removes the selected file by index', () => {
    const onRemove = vi.fn();
    renderSortableImageList(onRemove);

    fireEvent.click(screen.getByLabelText('Remove first.png'));

    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
