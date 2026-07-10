import '@testing-library/jest-dom/vitest';
import { fireEvent, render } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import {
  AnimationFrameList,
  type AnimationFrameFile,
} from '../animation-frame-list';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: dom.window,
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: dom.window.document,
});
Object.defineProperty(globalThis, 'HTMLElement', {
  configurable: true,
  value: dom.window.HTMLElement,
});
Object.defineProperty(globalThis, 'Element', {
  configurable: true,
  value: dom.window.Element,
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: vi.fn(() => 'blob:test'),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value: vi.fn(),
});

const frames: AnimationFrameFile[] = [
  {
    id: 'a',
    file: new File(['a'], 'first.png', { type: 'image/png' }),
    delayMs: 160,
  },
  {
    id: 'b',
    file: new File(['b'], 'second.png', { type: 'image/png' }),
    delayMs: 200,
  },
];

function renderList(onRemove = vi.fn()) {
  const onReorder = vi.fn();
  const result = render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <AnimationFrameList
        frames={frames}
        onReorder={onReorder}
        onRemove={onRemove}
        disabled={false}
      />
    </NextIntlClientProvider>
  );
  return { ...result, onReorder, onRemove };
}

describe('AnimationFrameList', () => {
  it('renders frame names, sequence numbers, and frame delays', () => {
    const { getByText } = renderList();

    expect(getByText('first.png')).toBeInTheDocument();
    expect(getByText('second.png')).toBeInTheDocument();
    expect(getByText('01')).toBeInTheDocument();
    expect(getByText('160 ms')).toBeInTheDocument();
  });

  it('removes a frame by index', () => {
    const onRemove = vi.fn();
    const { getByLabelText } = renderList(onRemove);

    expect(getByLabelText('Drag first.png')).toBeInTheDocument();
    fireEvent.click(getByLabelText('Remove first.png'));

    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
