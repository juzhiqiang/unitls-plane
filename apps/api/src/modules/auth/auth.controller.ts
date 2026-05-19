import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { auth } from '@utils-plane/auth';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/auth')
@Public()
export class AuthController {
  @All('*')
  async handle(@Req() req: Request, @Res() res: Response) {
    const baseUrl = `http://${req.headers.host}`;
    const url = new URL(req.url, baseUrl).toString();
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method)
        ? undefined
        : JSON.stringify(req.body),
    });

    const response = await auth.handler(request);

    // Forward response
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.status(response.status);
    const body = await response.text();
    res.send(body);
  }
}