import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from '../markdown-preview';

describe('MarkdownPreview', () => {
  it('accepts layout classes for roomy document workbenches', () => {
    render(
      <MarkdownPreview
        content="# Title"
        format="markdown"
        className="min-h-[604px]"
        viewportClassName="min-h-[560px]"
      />
    );

    expect(screen.getByText('Title').closest('.min-h-\\[604px\\]')).not.toBe(
      null
    );
    expect(screen.getByText('Title').closest('.min-h-\\[560px\\]')).not.toBe(
      null
    );
  });
});
