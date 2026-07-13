import { All, Controller, Req, Res, Logger } from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { eq } from 'drizzle-orm';
import { auth, sendExistingUserVerificationEmail } from '@utils-plane/auth';
import { db, user } from '@utils-plane/db';
import { Public } from '../../common/decorators/public.decorator';
import { ensureEmailCanSignUp } from './signup-policy';

@Controller('api/auth')
@Public()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  @All('*path')
  async handle(@Req() req: ExpressRequest, @Res() res: Response) {
    await this.handleSignUpEmailPolicy(req);

    const url = new URL(req.originalUrl, `http://${req.headers.host}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && key !== 'content-length') {
        headers.set(key, value);
      }
    }

    const body = ['GET', 'HEAD'].includes(req.method)
      ? undefined
      : JSON.stringify(req.body);

    const request = new globalThis.Request(url.toString(), {
      method: req.method,
      headers,
      body,
    });

    try {
      const response = await auth.handler(request);

      const setCookies =
        typeof (
          response.headers as Headers & {
            getSetCookie?: () => string[];
          }
        ).getSetCookie === 'function'
          ? (
              response.headers as Headers & {
                getSetCookie: () => string[];
              }
            ).getSetCookie()
          : [];

      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        if (key.toLowerCase().startsWith('access-control-')) return;
        res.setHeader(key, value);
      });

      for (const cookie of setCookies) {
        res.appendHeader('Set-Cookie', cookie);
      }

      res.status(response.status);
      const text = await response.text();
      res.send(text);
    } catch (err) {
      this.logger.error('Auth handler error:', err);
      throw err;
    }
  }

  private async handleSignUpEmailPolicy(req: ExpressRequest) {
    if (
      req.method !== 'POST' ||
      !req.originalUrl.split('?')[0]?.endsWith('/api/auth/sign-up/email')
    ) {
      return;
    }

    const email =
      typeof req.body?.email === 'string' ? req.body.email : undefined;
    if (!email) return;

    await ensureEmailCanSignUp({
      email,
      findUserByEmail: async normalizedEmail => {
        const [existing] = await db
          .select({
            email: user.email,
            emailVerified: user.emailVerified,
          })
          .from(user)
          .where(eq(user.email, normalizedEmail))
          .limit(1);

        return existing ?? null;
      },
      resendVerificationEmail: async existing =>
        sendExistingUserVerificationEmail({
          user: existing,
        }),
    });
  }
}
