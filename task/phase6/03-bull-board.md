# 03 - Bull Board 保护

> 依赖：Phase 2 / 06-bullmq
> 预估：1h
> 可并行：与所有其他任务

## 目标

为 Bull Board 监控面板添加访问保护，仅 admin 可访问。

## 步骤

### 3.1 添加管理员标识

`packages/db/src/schema.ts` users 表添加：

```typescript
role: text('role', { enum: ['user', 'admin'] }).default('user').notNull(),
```

生成 migration：

```bash
cd packages/db
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

### 3.2 创建 AdminGuard

`apps/api/src/common/guards/admin.guard.ts`:

```typescript
@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (!request.user) return false;

    // 从 DB 查询用户 role
    const user = await db.query.users.findFirst({
      where: eq(users.id, request.user.id),
    });

    return user?.role === 'admin';
  }
}
```

### 3.3 保护 Bull Board 路由

修改 BullBoardModule 配置，添加 Basic Auth 或在 reverse proxy 层处理。

或者用 NestJS middleware：

```typescript
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';

@Module({...})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(BasicAuthMiddleware)
      .forRoutes('/admin/queues');
  }
}
```

`apps/api/src/common/middleware/basic-auth.middleware.ts`:

```typescript
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
```

### 3.4 环境变量

```env
ADMIN_USER=admin
ADMIN_PASSWORD=<强密码>
```

### 3.5 监控指标

确保 Bull Board 展示：

- 各队列 active/waiting/completed/failed 数量
- 失败任务详情
- 重试历史
- 任务耗时分布

## 验收标准

- [ ] 未认证访问 /admin/queues → 401
- [ ] 正确凭证访问能进入
- [ ] 队列状态实时更新
- [ ] 能查看失败任务日志
