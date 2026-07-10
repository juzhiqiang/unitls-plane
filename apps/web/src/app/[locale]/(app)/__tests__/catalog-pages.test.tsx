import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../../messages/en.json';
import ImagePage from '../image/page';
import PdfPage from '../pdf/page';

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

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement('a', { href, ...props }, children),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('tool catalog pages', () => {
  it('shows the image catalog as local-first grouped tool intents', () => {
    const { getByRole, getByText } = renderWithIntl(<ImagePage />);

    expect(getByText('Local first, server optional')).toBeInTheDocument();
    expect(getByText('Browser session only')).toBeInTheDocument();
    expect(getByText('No sign-in required')).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Optimize' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Convert' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Batch' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Animation' })).toBeInTheDocument();
    expect(getByRole('link', { name: /Image compression/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/image/compress')
    );
    expect(getByRole('link', { name: /GIF \/ APNG maker/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/image/animation')
    );
  });

  it('shows the PDF catalog as server-processed grouped tool intents', () => {
    const { getByRole, getByText } = renderWithIntl(<PdfPage />);

    expect(getByText('Server processing')).toBeInTheDocument();
    expect(getByText('Saved to account files')).toBeInTheDocument();
    expect(getByText('Sign-in required')).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Organize' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Optimize' })).toBeInTheDocument();
    expect(getByRole('link', { name: /Merge PDF/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/pdf/merge')
    );
  });
});
