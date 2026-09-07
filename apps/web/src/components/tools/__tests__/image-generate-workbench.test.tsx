import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageGenerateWorkbench } from '../image-generate-workbench';

describe('ImageGenerateWorkbench', () => {
  it('renders the title, the panel slot and the main slot', () => {
    render(
      <ImageGenerateWorkbench
        title="AI image generation"
        panel={<p>panel content</p>}
        panelFooter={<button type="button">Generate</button>}
      >
        <p>main content</p>
      </ImageGenerateWorkbench>
    );

    expect(
      screen.getByRole('heading', { name: 'AI image generation' })
    ).toBeInTheDocument();
    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(screen.getByText('main content')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Generate' })
    ).toBeInTheDocument();
  });

  it('keeps the panel footer outside the scrollable panel area', () => {
    const { container } = render(
      <ImageGenerateWorkbench
        title="AI image generation"
        panel={<p>panel content</p>}
        panelFooter={<button type="button">Generate</button>}
      >
        <p>main content</p>
      </ImageGenerateWorkbench>
    );

    // 可滚动区(overflow-y-auto)与底部固定区必须是兄弟节点,按钮才不会跟着参数一起滚走。
    const scrollable = container.querySelector('.lg\\:overflow-y-auto');
    expect(scrollable).not.toBeNull();
    expect(scrollable!.textContent).toContain('panel content');
    expect(scrollable!.textContent).not.toContain('Generate');
  });
});
