import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@utils-plane/auth';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): User | undefined => {
    return ctx.switchToHttp().getRequest().user;
  }
);