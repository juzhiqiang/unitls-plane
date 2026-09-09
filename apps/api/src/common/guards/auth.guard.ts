import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifySession } from '@utils-plane/auth';
import {
  IS_PUBLIC_KEY,
  SKIP_SESSION_KEY,
} from '../decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipSession = this.reflector.getAllAndOverride<boolean>(
      SKIP_SESSION_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (skipSession) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();

    // Convert express headers to Headers object
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      }
    }

    const verified = await verifySession(headers);
    const { session, headers: responseHeaders } = verified ?? {
      session: null,
      headers: undefined,
    };

    if (!session) {
      if (isPublic) return true;
      throw new UnauthorizedException('Not authenticated');
    }

    this.forwardRenewedSessionCookies(context, responseHeaders);

    request.user = session.user;
    request.session = session.session;
    return true;
  }

  private forwardRenewedSessionCookies(
    context: ExecutionContext,
    responseHeaders: Headers | undefined
  ) {
    if (!(responseHeaders instanceof Headers)) return;
    const cookies = responseHeaders.getSetCookie();
    if (cookies.length === 0) return;

    const response = context.switchToHttp().getResponse();
    const existing = response.getHeader('set-cookie');
    const merged = [
      ...(Array.isArray(existing)
        ? existing.map(String)
        : existing
          ? [String(existing)]
          : []),
      ...cookies,
    ];
    response.setHeader('set-cookie', merged);
  }
}
