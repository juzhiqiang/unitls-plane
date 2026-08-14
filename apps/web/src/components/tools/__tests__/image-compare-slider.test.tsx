import type { ImgHTMLAttributes, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageCompareSlider } from '../image-compare-slider.client';

vi.mock('react-compare-slider', () => ({
  ReactCompareSlider: ({
    itemOne,
    itemTwo,
    className,
  }: {
    itemOne: ReactNode;
    itemTwo: ReactNode;
    className?: string;
  }) => (
    <div data-testid="compare-slider" className={className}>
      {itemOne}
      {itemTwo}
    </div>
  ),
  ReactCompareSliderImage: (props: ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ''} />;
  },
}));

describe('ImageCompareSlider', () => {
  it('shows both images completely inside the comparison frame', () => {
    render(
      <ImageCompareSlider originalUrl="blob:original" resultUrl="blob:result" />
    );

    expect(screen.getByTestId('compare-slider')).toHaveClass(
      'h-full',
      'w-full'
    );
    expect(screen.getByTestId('compare-slider')).not.toHaveClass(
      'aspect-video'
    );
    expect(screen.getByAltText('Original')).toHaveStyle({
      objectFit: 'contain',
      objectPosition: 'center',
    });
    expect(screen.getByAltText('Result')).toHaveStyle({
      objectFit: 'contain',
      objectPosition: 'center',
    });
  });
});
