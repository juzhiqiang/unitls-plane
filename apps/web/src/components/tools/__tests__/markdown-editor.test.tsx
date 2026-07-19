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

  it('keeps the source editor at a fixed height with horizontal and vertical scrolling', () => {
    const longMarkdown = Array.from(
      { length: 40 },
      (_, index) => `line ${index + 1} with a long source value`
    ).join('\n');

    render(
      <MarkdownEditor
        label="Markdown"
        value={longMarkdown}
        onChange={vi.fn()}
      />
    );

    const textarea = screen.getByRole('textbox', { name: 'Markdown' });
    const editorSurface = textarea.parentElement;

    expect(editorSurface).toHaveClass('h-[520px]');
    expect(editorSurface).not.toHaveClass('min-h-[520px]');
    expect(textarea).toHaveAttribute('wrap', 'off');
    expect(textarea).toHaveClass('h-full', 'resize-none', 'overflow-auto');
    expect(textarea).not.toHaveClass('min-h-[520px]', 'resize-y');
  });

  it('renders highlighted markdown source behind the only input control', () => {
    const source = [
      '# Highlighted title',
      '',
      '- list item',
      '- [visible link](https://example.com)',
      '',
      '**strong text**',
      '',
      '```ts',
      'const answer = 42;',
      '```',
    ].join('\n');
    const { container } = render(
      <MarkdownEditor label="Markdown" value={source} onChange={vi.fn()} />
    );

    const highlightLayer = container.querySelector('pre[aria-hidden="true"]');
    const highlightedCode = highlightLayer?.querySelector('code.hljs');
    const highlightedTokens = highlightedCode?.querySelectorAll(
      'span[class*="hljs-"]'
    );

    expect(highlightLayer).toBeInTheDocument();
    expect(highlightLayer).toHaveClass('pointer-events-none');
    expect(highlightedCode).toBeInTheDocument();
    expect(highlightedTokens?.length).toBeGreaterThanOrEqual(2);
    expect(highlightedCode).toHaveTextContent('Highlighted title');
    expect(highlightedCode).toHaveTextContent('visible link');
    expect(screen.getAllByRole('textbox', { name: 'Markdown' })).toHaveLength(
      1
    );
    expect(highlightLayer).not.toContainElement(
      screen.getByRole('textbox', { name: 'Markdown' })
    );
  });

  it('synchronizes editor scrolling with the gutter and highlight layer', () => {
    const { container } = render(
      <MarkdownEditor
        label="Markdown"
        value={'# Title\n\n- item\n\n`code`'}
        onChange={vi.fn()}
      />
    );

    const textarea = screen.getByRole('textbox', { name: 'Markdown' });
    const gutter = container.querySelector(
      'div.preview-scroll[aria-hidden="true"]'
    ) as HTMLElement | null;
    const highlightLayer = container.querySelector(
      'pre[aria-hidden="true"]'
    ) as HTMLElement | null;

    expect(gutter).toBeInTheDocument();
    expect(highlightLayer).toBeInTheDocument();

    textarea.scrollTop = 144;
    textarea.scrollLeft = 32;
    fireEvent.scroll(textarea);

    expect(gutter?.scrollTop).toBe(144);
    expect(highlightLayer?.scrollTop).toBe(144);
    expect(highlightLayer?.scrollLeft).toBe(32);
  });

  it('emits raw markdown changes without transforming the source', () => {
    const onChange = vi.fn();
    render(
      <MarkdownEditor label="Markdown" value="# Title" onChange={onChange} />
    );

    const rawSource =
      '<Custom data-kind="raw" />\n\n# <Title />\n\n```tsx\nconst node = <View />;\n```';

    fireEvent.change(screen.getByLabelText('Markdown'), {
      target: { value: rawSource },
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(rawSource);
  });
});
