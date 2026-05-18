# 06 - Better-Auth 配置（packages/auth）

> 依赖：03-db、05-docker-services
> 预估：2h

## 目标

创建共享的 Better-Auth 配置包，供 apps/web 和 apps/api 复用。配置 Email/Password、Google OAuth、GitHub OAuth。

## 步骤

### 6.1 安装依赖

```bash
cd packages/auth
bun add better-auth
bun add @utils-plane/db   # workspace 引用
```

### 6.2 创建 Better-Auth 实例

`packages/auth/src/index.ts`:

```typescript
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@utils-plane/db';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
  }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  trustedOrigins: [
    process.env.NEXT_PUBLIC_API_URL!,
    'http://localhost:3000',
    'http://localhost:3001',
  ],

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 天
    updateAge: 60 * 60 * 24, // 1 天刷新一次
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  user: {
    additionalFields: {
      plan: {
        type: 'string',
        defaultValue: 'free',
      },
      role: {
        type: 'string',
        defaultValue: 'user',
      },
    },
  },
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
```

### 6.3 生成 Auth 表 Schema

Better-Auth 提供 CLI 自动生成 schema：

```bash
cd packages/auth
bunx @better-auth/cli@latest generate --output ../db/src/schema/auth.ts
```

生成的表：

- `user` — 主用户表
- `session` — 会话
- `account` — OAuth 关联
- `verification` — 邮箱/重置令牌

### 6.4 集成到 packages/db schema

`packages/db/src/schema/index.ts`:

```typescript
export * from './auth'; // Better-Auth 生成的表
export * from './files';
export * from './tasks';
```

更新 `packages/db/src/schema/files.ts` 和 `tasks.ts`，让 user_id 引用 better-auth 的 `user.id`：

```typescript
import { user } from './auth';

export const files = pgTable('files', {
  // ...
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  // ...
});
```

### 6.5 生成 migration

```bash
cd packages/db
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

### 6.6 生成 BETTER_AUTH_SECRET

```bash
openssl rand -base64 32
# 写入 .env.local
```

### 6.7 配置 OAuth Provider

#### Google OAuth

1. https://console.cloud.google.com → 创建 OAuth 2.0 Client
2. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - 生产域名相应路径

#### GitHub OAuth

1. https://github.com/settings/developers → OAuth Apps → New
2. Authorization callback URL:
   - `http://localhost:3000/api/auth/callback/github`

将 Client ID/Secret 写入 `.env.local`。

### 6.8 导出辅助类型

`packages/auth/src/index.ts`:

```typescript
// 供 NestJS 后端使用
export async function verifySession(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  return session;
}
```

### 6.9 邮件发送（可选，开发期跳过）

开发环境：邮件直接 console.log，生产环境再配置 Resend / Mailgun。

```typescript
emailVerification: {
  sendVerificationEmail: async ({ user, url }) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Verify Email] ${user.email}: ${url}`);
      return;
    }
    // 生产环境调用邮件服务
  },
},
```

## 验收标准

- [ ] `packages/auth` 能被其他 workspace 引用
- [ ] DB 中存在 user/session/account/verification 表
- [ ] 调用 `auth.api.signUpEmail` 能创建用户
- [ ] 调用 `auth.api.signInEmail` 返回 session
- [ ] Google/GitHub OAuth redirect URL 已配置
- [ ] 邮件验证 token 能在 console 中看到（dev）
