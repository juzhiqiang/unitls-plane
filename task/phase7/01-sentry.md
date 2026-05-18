# 01 - Sentry 错误追踪

> 依赖：Phase 2, 3
> 预估：1.5h
> 可并行：与 02/03

## 目标

集成 Sentry 到 NestJS 后端和 Next.js 前端，统一错误监控。

## 步骤

### 1.1 创建 Sentry 项目

1. https://sentry.io → New Project
2. 创建两个项目：
   - `utils-plane-api` (Node.js)
   - `utils-plane-web` (Next.js)
3. 获取 DSN

### 1.2 后端集成

```bash
cd apps/api
bun add @sentry/node @sentry/profiling-node
```

`apps/api/src/lib/sentry.ts`:

```typescript
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

export function initSentry() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
  });
}
```

`apps/api/src/main.ts`:

```typescript
import { initSentry } from './lib/sentry';
initSentry(); // 必须在 NestFactory.create 之前

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // ...
}
```

更新 `AllExceptionsFilter`，在 500 错误时上报 Sentry：

```typescript
if (!isHttp || status >= 500) {
  Sentry.captureException(exception);
}
```

### 1.3 前端集成

```bash
cd apps/web
bunx @sentry/wizard@latest -i nextjs
```

或手动：

```bash
bun add @sentry/nextjs
```

创建 `sentry.client.config.ts`、`sentry.server.config.ts`、`sentry.edge.config.ts`：

```typescript
// sentry.client.config.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
});
```

更新 `next.config.ts`:

```typescript
import { withSentryConfig } from '@sentry/nextjs';

export default withSentryConfig(
  withPWA(...)(config),
  {
    org: 'your-org',
    project: 'utils-plane-web',
    silent: !process.env.CI,
  },
);
```

### 1.4 Source Maps 上传

在 CI 中设置 `SENTRY_AUTH_TOKEN`，构建时自动上传 source maps。

### 1.5 用户上下文

登录后设置用户标识：

```typescript
Sentry.setUser({
  id: user.id,
  email: user.email,
});
```

登出时清理：

```typescript
Sentry.setUser(null);
```

### 1.6 性能监控

确认追踪：

- 页面加载耗时
- API 调用耗时
- Bull job 处理耗时

### 1.7 告警配置

在 Sentry Dashboard 设置：

- 5xx 错误率 > 1% 告警
- 新出现的错误自动通知
- 性能退化告警

## 验收标准

- [ ] 后端故意抛错 → Sentry 收到事件
- [ ] 前端故意抛错 → Sentry 收到事件
- [ ] Session Replay 工作（前端）
- [ ] 用户信息正确关联
- [ ] Source maps 可用（错误堆栈有源码位置）
