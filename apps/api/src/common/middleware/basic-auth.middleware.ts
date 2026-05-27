import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class BasicAuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Basic ')) {
      return this.unauthorized(res);
    }

    const [user, pass] = Buffer.from(auth.slice(6), 'base64')
      .toString()
      .split(':');

    if (
      user !== process.env.ADMIN_USER ||
      pass !== process.env.ADMIN_PASSWORD
    ) {
      return this.unauthorized(res);
    }

    next();
  }

  private unauthorized(res: Response) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    res.status(401).send('Unauthorized');
  }
}
