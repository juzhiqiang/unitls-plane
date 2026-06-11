import { describe, expect, it, vi } from 'vitest';

vi.mock('geist/font/sans', () => ({
  GeistSans: { variable: 'font-sans' },
}));

vi.mock('geist/font/mono', () => ({
  GeistMono: { variable: 'font-mono' },
}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => {
    const messages: Record<string, string> = {
      title: 'Utils Plane - Free Online Toolkit',
      description: 'Toolkit description',
    };
    return messages[key] ?? key;
  }),
  getMessages: vi.fn(),
  setRequestLocale: vi.fn(),
}));

vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}));

vi.mock('@/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/providers/query-provider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/pwa/install-prompt', () => ({
  InstallPrompt: () => null,
}));

vi.mock('sonner', () => ({
  Toaster: () => null,
}));

import { generateMetadata, viewport } from '../layout';
import { primaryToolHrefs } from '@/lib/tools/tool-metadata';

describe('locale layout PWA metadata', () => {
  it('exposes manifest and apple web app metadata', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
    });

    expect(metadata.manifest).toBe('/manifest.json');
    expect(metadata.appleWebApp).toEqual(
      expect.objectContaining({
        capable: true,
        statusBarStyle: 'default',
        title: 'Utils-Plane',
      })
    );
    expect(metadata.icons).toEqual(
      expect.objectContaining({
        icon: '/icons/icon-32.png',
        apple: '/icons/icon-180.png',
      })
    );
  });

  it('exposes the PWA theme color through viewport metadata', () => {
    expect(viewport.themeColor).toBe('#0a0a0c');
  });

  it('does not point primary tool journeys at missing documentation routes', () => {
    expect(primaryToolHrefs).not.toContain('/docs');
    expect(primaryToolHrefs).toContain('/image/compress');
    expect(primaryToolHrefs).toContain('/pdf/merge');
    expect(primaryToolHrefs).toContain('/font');
  });
});
