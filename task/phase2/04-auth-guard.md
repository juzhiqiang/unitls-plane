# 04 - Supabase JWT Auth Guard

> 依赖：01-nestjs-init
> 预估：2h
> 可并行：与 02/03/05/06/08 同时执行

## 目标

实现 Auth Guard 验证前端传来的 Supabase JWT，注入 user 到 request。

## 步骤

### 4.1 安装依赖

```bash
cd apps/api
bun add @supabase/supabase-js
```

### 4.2 创建 Supabase 客户端

`apps/api/src/lib/supabase.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
```

### 4.3 创建 Auth Guard

`apps/api/src/common/guards/auth.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { supabase } from '../../lib/supabase';
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
    const token = this.extractToken(request);

    // 匿名访问支持（部分接口允许）
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Missing token');
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      if (isPublic) return true;  // public 接口即使 token 无效也放行
      throw new UnauthorizedException('Invalid token');
    }

    request.user = data.user;
    return true;
  }

  private extractToken(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
```

### 4.4 创建 @Public 装饰器

`apps/api/src/common/decorators/public.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### 4.5 创建 @CurrentUser 装饰器

`apps/api/src/common/decorators/current-user.decorator.ts`:
```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;  // 可能为 undefined（匿名）
  },
);
```

### 4.6 全局应用 Guard

`apps/api/src/app.module.ts`:
```typescript
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './common/guards/auth.guard';

@Module({
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
```

## 验收标准

- [ ] 无 token 访问受保护接口 → 401
- [ ] 无效 token → 401
- [ ] 有效 token → request.user 可用
- [ ] @Public() 装饰的接口允许匿名访问
