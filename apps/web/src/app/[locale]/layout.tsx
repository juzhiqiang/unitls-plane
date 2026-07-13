import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { NextIntlClientProvider } from 'next-intl';
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { Toaster } from 'sonner';
import { routing } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';
import '../globals.css';

export const viewport: Viewport = {
  themeColor: '#0a0a0c',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Common.meta' });
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const languages = Object.fromEntries(
    routing.locales.map(l => [l, `${baseUrl}/${l}`])
  );

  return {
    title: t('title'),
    description: t('description'),
    manifest: '/manifest.json',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'Utils-Plane',
    },
    icons: {
      icon: [
        {
          url: '/icons/utils-plane-favicon-32.png',
          sizes: '32x32',
          type: 'image/png',
        },
      ],
      shortcut: '/favicon.ico',
      apple: [
        {
          url: '/icons/utils-plane-apple-touch-180.png',
          sizes: '180x180',
          type: 'image/png',
        },
      ],
    },
    alternates: {
      canonical: `${baseUrl}/${locale}`,
      languages: {
        ...languages,
        'x-default': `${baseUrl}/${routing.defaultLocale}`,
      },
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="font-sans antialiased">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <QueryProvider>
              {children}
              <InstallPrompt />
              <Toaster position="bottom-right" richColors />
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
