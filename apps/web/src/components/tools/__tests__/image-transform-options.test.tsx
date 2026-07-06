import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { ImageTransformOptions } from '../image-transform-options';
import type { NormalizedImageTransform } from '@/lib/processing/image-transform-client';

const messages = {
  ImageTransform: {
    title: 'Transform',
    autoOrient: 'Auto orient',
    rotate: 'Rotate',
    rotateLeft: 'Rotate left',
    rotateRight: 'Rotate right',
    resetRotation: 'Reset rotation',
    flip: 'Flip',
    flipHorizontal: 'Flip horizontal',
    flipVertical: 'Flip vertical',
    currentRotation: '{degrees} deg',
  },
};

function renderOptions(value: NormalizedImageTransform, onChange = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ImageTransformOptions value={value} onChange={onChange} />
    </NextIntlClientProvider>
  );
  return onChange;
}

describe('ImageTransformOptions', () => {
  it('emits normalized transform changes from controls', () => {
    const value: NormalizedImageTransform = {
      autoOrient: true,
      rotate: 0,
      flipHorizontal: false,
      flipVertical: false,
    };
    const onChange = renderOptions(value);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flip horizontal' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto orient' }));

    expect(onChange).toHaveBeenNthCalledWith(1, {
      ...value,
      rotate: 90,
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      ...value,
      flipHorizontal: true,
    });
    expect(onChange).toHaveBeenNthCalledWith(3, {
      ...value,
      autoOrient: false,
    });
  });
});
