import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/register', '/image', '/pdf', '/font', '/api/auth'];
const AUTH_PATHS = ['/login', '/register'];

export async function middleware(request: NextRequest) {
  const sessionToken = request.cookies.get('better-auth.session_token');
  const { pathname } = request.nextUrl;

  // Redirect authenticated users away from auth pages
  if (sessionToken && AUTH_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Check if the path is public
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  // If not public and no session, redirect to login
  if (!sessionToken && !isPublic && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(
      new URL('/login?redirect=' + pathname, request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};