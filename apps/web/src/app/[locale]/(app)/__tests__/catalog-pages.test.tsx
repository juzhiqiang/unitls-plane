import React from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../../messages/en.json';
import ImagePage from '../image/page';
import PdfPage from '../pdf/page';

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
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('tool catalog pages', () => {
  it('shows the image catalog as local-first grouped tool intents', () => {
    renderWithIntl(<ImagePage />);

    expect(screen.getByText('Local first, server optional')).toBeInTheDocument();
    expect(screen.getByText('Browser session only')).toBeInTheDocument();
    expect(screen.getByText('No sign-in required')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Optimize' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Convert' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Batch' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Image compression/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/image/compress'),
    );
  });

  it('shows the PDF catalog as server-processed grouped tool intents', () => {
    renderWithIntl(<PdfPage />);

    expect(screen.getByText('Server processing')).toBeInTheDocument();
    expect(screen.getByText('Saved to account files')).toBeInTheDocument();
    expect(screen.getByText('Sign-in required')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Organize' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Optimize' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Merge PDF/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/pdf/merge'),
    );
  });
});
