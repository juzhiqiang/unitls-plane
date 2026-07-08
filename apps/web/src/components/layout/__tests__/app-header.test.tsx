import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppHeader } from '../app-header';
import { SidebarProvider } from '@/components/ui/sidebar';

const linkSpy = vi.fn();
let mockedPathname = '/pdf/merge';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: null, isPending: false }),
  signOut: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => {
    linkSpy(href);
    return React.createElement(
      'a',
      { href: `/en${href === '/' ? '' : href}`, ...props },
      children
    );
  },
  usePathname: () => mockedPathname,
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

describe('AppHeader', () => {
  it('renders breadcrumb links through the locale-aware navigation Link', () => {
    mockedPathname = '/pdf/merge';
    linkSpy.mockClear();

    render(
      <SidebarProvider>
        <AppHeader />
      </SidebarProvider>
    );

    expect(linkSpy).not.toHaveBeenCalledWith('/dashboard');
    expect(linkSpy).toHaveBeenCalledWith('/pdf');
    expect(screen.getByRole('link', { name: 'pdfTools' })).toHaveAttribute(
      'href',
      '/en/pdf'
    );
    expect(
      screen.getByText('ToolCatalog.tools.pdfMerge.title')
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'home' })).not.toBeInTheDocument();
  });

  it('uses translated tool titles for multi-word tool breadcrumb pages', () => {
    mockedPathname = '/image/id-photo';
    linkSpy.mockClear();

    render(
      <SidebarProvider>
        <AppHeader />
      </SidebarProvider>
    );

    expect(screen.getByRole('link', { name: 'imageTools' })).toHaveAttribute(
      'href',
      '/en/image'
    );
    expect(
      screen.getByText('ToolCatalog.tools.imageIdPhoto.title')
    ).toBeInTheDocument();
    expect(screen.queryByText('Id-photo')).not.toBeInTheDocument();
  });

  it('renders dashboard as the current page instead of a leading crumb', () => {
    mockedPathname = '/dashboard';
    linkSpy.mockClear();

    render(
      <SidebarProvider>
        <AppHeader />
      </SidebarProvider>
    );

    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(linkSpy).not.toHaveBeenCalledWith('/dashboard');
  });
});
