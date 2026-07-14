import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { routing, type Locale } from '@/i18n/routing';
import { getPublicSiteBaseUrl } from '@/lib/public-site';
import { getToolByHref } from './tool-metadata';

const categoryMessages = {
  image: {
    path: '/image',
    titleKey: 'ImageTool.title',
    descriptionKey: 'ImageTool.description',
  },
  pdf: {
    path: '/pdf',
    titleKey: 'PdfTool.title',
    descriptionKey: 'PdfTool.description',
  },
} as const;

type ToolCategory = keyof typeof categoryMessages;
type MetadataParams = { params: Promise<{ locale: string }> };

function createAlternates(locale: Locale, path: string) {
  const baseUrl = getPublicSiteBaseUrl();
  const languages = Object.fromEntries(
    routing.locales.map(language => [language, `${baseUrl}/${language}${path}`])
  );

  return {
    canonical: `${baseUrl}/${locale}${path}`,
    languages: {
      ...languages,
      'x-default': `${baseUrl}/${routing.defaultLocale}${path}`,
    },
  };
}

function isLocale(locale: string): locale is Locale {
  return routing.locales.includes(locale as Locale);
}

export async function createToolRouteMetadata(
  locale: Locale,
  href: string
): Promise<Metadata> {
  const tool = getToolByHref(href);

  if (!tool) {
    return {};
  }

  const t = await getTranslations({ locale });

  return {
    title: t(tool.titleKey),
    description: t(tool.descriptionKey),
    alternates: createAlternates(locale, href),
  };
}

export async function createCategoryRouteMetadata(
  locale: Locale,
  category: ToolCategory
): Promise<Metadata> {
  const messages = categoryMessages[category];
  const t = await getTranslations({ locale });

  return {
    title: t(messages.titleKey),
    description: t(messages.descriptionKey),
    alternates: createAlternates(locale, messages.path),
  };
}

export function createToolMetadataGenerator(href: string) {
  return async ({ params }: MetadataParams): Promise<Metadata> => {
    const { locale } = await params;

    if (!isLocale(locale)) {
      return {};
    }

    return createToolRouteMetadata(locale, href);
  };
}

export function createCategoryMetadataGenerator(category: ToolCategory) {
  return async ({ params }: MetadataParams): Promise<Metadata> => {
    const { locale } = await params;

    if (!isLocale(locale)) {
      return {};
    }

    return createCategoryRouteMetadata(locale, category);
  };
}

export function ToolMetadataLayout({ children }: { children: ReactNode }) {
  return children;
}
