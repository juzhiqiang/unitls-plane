import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import type { Locale } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/image',
  '/pdf',
  '/font',
  '/privacy',
  '/terms',
  '/beta',
  '/changelog',
  '/api/auth',
];

function stripLocale(pathname: string): { locale: Locale; path: string } {
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (first && routing.locales.includes(first as Locale)) {
    const path = '/' + segments.slice(1).join('/');
    return {
      locale: first as Locale,
      path: path === '/' ? '/' : path.replace(/\/$/, ''),
    };
  }
  return { locale: routing.defaultLocale, path: pathname };
}

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bypass i18n for API routes; perform no auth here either (auth handled by NestJS)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get('better-auth.session_token');
  const { locale, path } = stripLocale(pathname);

  // Redirect unauthenticated users away from protected pages
  if (!sessionToken && !isPublicPath(path)) {
    const redirectUrl = new URL(`/${locale}/login`, request.url);
    redirectUrl.searchParams.set('next', path);
    return NextResponse.redirect(redirectUrl);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
