import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageCropField } from '@/components/tools/image-crop-field';

const t = (key: string) => key;

const baseProps = {
  imageUrl: 'data:image/png;base64,AAAA',
  natural: { width: 400, height: 560 },
  onNatural: vi.fn(),
  value: { x: 40, y: 40, width: 295, height: 413 },
  onChange: vi.fn(),
  aspect: 295 / 413,
  t,
};

describe('ImageCropField guides', () => {
  it('does not render guides by default', () => {
    render(<ImageCropField {...baseProps} />);
    expect(screen.queryByTestId('crop-guide-headroom')).toBeNull();
  });

  it('renders headroom, eye-line, shoulder and center guides when enabled', () => {
    render(<ImageCropField {...baseProps} guides />);
    expect(screen.getByTestId('crop-guide-headroom')).toBeTruthy();
    expect(screen.getByTestId('crop-guide-eye')).toBeTruthy();
    expect(screen.getByTestId('crop-guide-shoulder')).toBeTruthy();
    expect(screen.getByTestId('crop-guide-center')).toBeTruthy();
  });

  it('keeps guides non-interactive so dragging still works', () => {
    render(<ImageCropField {...baseProps} guides />);
    expect(screen.getByTestId('crop-guide-headroom').className).toContain(
      'pointer-events-none'
    );
  });
});
