import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from '../markdown-editor';

describe('MarkdownEditor', () => {
  it('renders an editor surface with line numbers and source stats', () => {
    render(
      <MarkdownEditor
        label="Markdown"
        value={'# Title\n\n- item'}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Markdown')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('3 ln')).toBeInTheDocument();
  });

  it('emits raw markdown changes without transforming the source', () => {
    const onChange = vi.fn();
    render(
      <MarkdownEditor label="Markdown" value="# Title" onChange={onChange} />
    );

    fireEvent.change(screen.getByLabelText('Markdown'), {
      target: { value: '<Custom />\n\n```ts\nconst x = 1;\n```' },
    });

    expect(onChange).toHaveBeenCalledWith(
      '<Custom />\n\n```ts\nconst x = 1;\n```'
    );
  });
});
