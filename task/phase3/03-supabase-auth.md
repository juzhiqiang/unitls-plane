# 03 - Supabase Auth 集成

> 依赖：01-nextjs-init
> 预估：2.5h
> 可并行：与 02/05 同时执行

## 目标

实现登录、注册、OAuth (Google/GitHub) 登录、登出、session 管理。

## 步骤

### 3.1 安装依赖

```bash
cd apps/web
bun add @supabase/supabase-js @supabase/ssr
```

### 3.2 创建 Supabase 客户端

`src/lib/supabase/client.ts` (Client Components):
```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

`src/lib/supabase/server.ts` (Server Components):
```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {}
        },
      },
    },
  );
}
```

### 3.3 创建 middleware.ts

`src/middleware.ts`:
```typescript
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Refresh session
  // 已登录用户访问 /login 重定向到 /dashboard
  // 未登录用户访问 (app) 路由重定向到 /login（除非允许匿名）
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
```

### 3.4 创建认证页面

```
src/app/(auth)/
├── layout.tsx          # 简约布局
├── login/page.tsx      # 登录
├── register/page.tsx   # 注册
└── callback/route.ts   # OAuth 回调
```

#### login/page.tsx
- Email + Password 表单（react-hook-form + zod）
- "使用 Google 登录" 按钮
- "使用 GitHub 登录" 按钮
- "还没账号？" 链接到 /register

#### register/page.tsx
- Email + Password + 确认密码
- 注册成功后提示邮箱验证

#### callback/route.ts
```typescript
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
```

### 3.5 创建 useUser hook

`src/hooks/use-user.ts`:
```typescript
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  return { user, loading };
}
```

### 3.6 实现登出

```typescript
async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  router.push('/login');
}
```

### 3.7 环境变量

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

## 验收标准

- [ ] Email/Password 注册 → 邮箱验证 → 登录成功
- [ ] Google OAuth 登录成功
- [ ] GitHub OAuth 登录成功
- [ ] Session 持久化（刷新页面仍登录）
- [ ] 登出后无法访问受保护页面
- [ ] middleware 重定向规则正确
