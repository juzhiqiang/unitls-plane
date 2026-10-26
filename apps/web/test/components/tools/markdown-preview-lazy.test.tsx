import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const dynamicState = vi.hoisted(() => ({
  loads: 0,
  ssr: undefined as boolean | undefined,
  hasLoading: false,
}));

vi.mock('next/dynamic', () => ({
  default: (
    loader: () => Promise<unknown>,
    options?: { ssr?: boolean; loading?: () => unknown }
  ) => {
    dynamicState.ssr = options?.ssr;
    dynamicState.hasLoading = typeof options?.loading === 'function';

    return function DynamicProbe() {
      dynamicState.loads += 1;
      void loader();
      return null;
    };
  },
}));

const { MarkdownPreview } = await import('@/components/tools/markdown-preview');

describe('MarkdownPreview lazy renderer', () => {
  it('keeps renderer dependencies out of the preview shell', () => {
    const previewSource = readFileSync(
      join(process.cwd(), 'src/components/tools/markdown-preview.tsx'),
      'utf8'
    );
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/components/tools/markdown-renderer.tsx'),
      'utf8'
    );

    expect(previewSource).toContain("import dynamic from 'next/dynamic'");
    expect(previewSource).toContain("import('./markdown-renderer')");
    expect(previewSource).not.toContain("from 'react-markdown'");
    expect(previewSource).not.toContain("from 'remark-gfm'");
    expect(previewSource).not.toContain("from 'rehype-highlight'");
    expect(rendererSource).toContain("from 'react-markdown'");
    expect(rendererSource).toContain("from 'remark-gfm'");
    expect(rendererSource).toContain("from 'rehype-highlight'");
  });

  it('does not mount the markdown renderer in text mode', () => {
    dynamicState.loads = 0;

    render(<MarkdownPreview content="# Plain text" format="text" />);

    expect(screen.getByText('# Plain text')).toBeInTheDocument();
    expect(dynamicState.loads).toBe(0);
  });

  it('does not mount a second renderer when switching markdown to source', () => {
    dynamicState.loads = 0;

    render(<MarkdownPreview content="# Source" format="markdown" />);
    fireEvent.click(screen.getByRole('button', { name: '源码' }));

    expect(screen.getByText('# Source')).toBeInTheDocument();
    expect(dynamicState.loads).toBe(1);
  });

  it('mounts the renderer only for the markdown preview', () => {
    dynamicState.loads = 0;

    render(<MarkdownPreview content="# Preview" format="markdown" />);

    expect(dynamicState.loads).toBe(1);
    expect(dynamicState.ssr).toBe(false);
    expect(dynamicState.hasLoading).toBe(true);
  });
});
