import { All, Controller, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { auth } from '@utils-plane/auth';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/auth')
@Public()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  @All('*path')
  async handle(@Req() req: Request, @Res() res: Response) {
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

    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      body,
    });

    try {
      const response = await auth.handler(request);

      const setCookies =
        typeof (response.headers as Headers & {
          getSetCookie?: () => string[];
        }).getSetCookie === 'function'
          ? (response.headers as Headers & {
              getSetCookie: () => string[];
            }).getSetCookie()
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
}
