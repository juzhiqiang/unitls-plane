# 04 - Better-Auth 集成（Auth Guard）

> 依赖：01-nestjs-init、Phase 1 / 06-better-auth
> 预估：2h
> 可并行：与 02/03/05/06/08 同时执行

## 目标

在 NestJS 集成 Better-Auth：暴露 auth handler 路由、实现 Guard 验证 session。

## 步骤

### 4.1 安装依赖

```bash
cd apps/api
bun add better-auth @utils-plane/auth
```

### 4.2 暴露 Better-Auth Handler

Better-Auth 把所有 auth 路由统一挂在 `/api/auth/*`，由后端转发给 better-auth 处理。

`apps/api/src/modules/auth/auth.controller.ts`:
```typescript
import { All, Controller, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { auth } from '@utils-plane/auth';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/auth')
@Public()
export class AuthController {
  @All('*')
  async handle(@Req() req: Request, @Res() res: Response) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as any,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });

    const response = await auth.handler(request);

    // 转发响应
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.status(response.status);
    const body = await response.text();
    res.send(body);
  }
}
```

`apps/api/src/modules/auth/auth.module.ts`:
```typescript
@Module({
  controllers: [AuthController],
})
export class AuthModule {}
```

### 4.3 实现 AuthGuard

`apps/api/src/common/guards/auth.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { auth } from '@utils-plane/auth';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();

    // 将 express headers 转成 Headers 对象
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(key, value);
    }

    const session = await auth.api.getSession({ headers });

    if (!session) {
      if (isPublic) return true;
      throw new UnauthorizedException('Not authenticated');
    }

    request.user = session.user;
    request.session = session.session;
    return true;
  }
}
```

### 4.4 @Public 装饰器

`apps/api/src/common/decorators/public.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### 4.5 @CurrentUser 装饰器

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@utils-plane/auth';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): User | undefined => {
    return ctx.switchToHttp().getRequest().user;
  },
);
```

### 4.6 全局注册

`apps/api/src/app.module.ts`:
```typescript
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [AuthModule, /* ... */],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
```

### 4.7 CORS 配置（重要）

Better-Auth 用 cookie 鉴权，前端跨域请求必须带 cookie：

`apps/api/src/main.ts`:
```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
  credentials: true,  // ★ 必须
});
```

前端调 fetch 时也必须 `credentials: 'include'`。

## 验收标准

- [ ] `POST /api/auth/sign-up/email` 创建用户成功
- [ ] `POST /api/auth/sign-in/email` 返回 session cookie
- [ ] 受保护接口无 cookie → 401
- [ ] 携带 session cookie 访问 → 返回用户数据
- [ ] @Public() 装饰的接口允许匿名访问
- [ ] OAuth redirect 流程能完整跑通
