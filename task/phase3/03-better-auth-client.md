# 03 - Better-Auth 前端集成

> 依赖：01-nextjs-init、Phase 1 / 06-better-auth
> 预估：2.5h
> 可并行：与 02/05 同时执行

> **🎨 UI 设计要求**：登录/注册页是产品门面，**必须**：
>
> 1. 先读 [`task/design-system.md`](../design-system.md)
> 2. 调用 `frontend-design` skill 产出登录/注册/邮箱验证三个页面方案
> 3. 极简卡片（1px 边框、无阴影）、左对齐表单、mono 等宽字体的小标记
> 4. OAuth 按钮使用 1px 边框 + brand 图标（Lucide stroke 1.5）
> 5. 双主题适配

## 目标

在 Next.js 前端集成 Better-Auth：登录、注册、OAuth、session 管理。

## 步骤

### 3.1 安装依赖

```bash
cd apps/web
bun add better-auth @utils-plane/auth
```

### 3.2 创建 Auth Client

`src/lib/auth-client.ts`:

```typescript
'use client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
```

### 3.3 配置 middleware

`src/middleware.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/register', '/image', '/pdf', '/font'];
const AUTH_PATHS = ['/login', '/register'];

export async function middleware(request: NextRequest) {
  const sessionToken = request.cookies.get('better-auth.session_token');
  const { pathname } = request.nextUrl;

  if (sessionToken && AUTH_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  const isPublic = PUBLIC_PATHS.some(
    p => pathname === p || pathname.startsWith(p + '/')
  );
  if (!sessionToken && !isPublic && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(
      new URL('/login?redirect=' + pathname, request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
```

### 3.4 创建认证页面

```
src/app/(auth)/
├── layout.tsx          # 简约布局
├── login/page.tsx
├── register/page.tsx
└── verify-email/page.tsx
```

#### login/page.tsx

```tsx
'use client';
import { signIn } from '@/lib/auth-client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await signIn.email({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    router.push('/dashboard');
  };

  const handleOAuth = (provider: 'google' | 'github') => {
    signIn.social({ provider, callbackURL: '/dashboard' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>登录</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleEmailLogin}>
          <Input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <Button type="submit" disabled={loading}>
            登录
          </Button>
        </form>
        <Separator />
        <Button variant="outline" onClick={() => handleOAuth('google')}>
          Google 登录
        </Button>
        <Button variant="outline" onClick={() => handleOAuth('github')}>
          GitHub 登录
        </Button>
      </CardContent>
    </Card>
  );
}
```

#### register/page.tsx

类似 login，调用 `signUp.email({ email, password, name })`。注册后跳转到 `/verify-email`。

### 3.5 useSession 使用

```tsx
'use client';
import { useSession } from '@/lib/auth-client';

export function UserAvatar() {
  const { data: session, isPending } = useSession();
  if (isPending) return <Skeleton className="h-8 w-8 rounded-full" />;
  if (!session) return null;
  return <Avatar>{session.user.name[0]}</Avatar>;
}
```

### 3.6 Server Component 中获取 session

`src/lib/auth-server.ts`:

```typescript
import { auth } from '@utils-plane/auth';
import { headers } from 'next/headers';

export async function getServerSession() {
  return auth.api.getSession({ headers: await headers() });
}
```

使用：

```tsx
export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');
  return <div>欢迎，{session.user.name}</div>;
}
```

### 3.7 登出

```tsx
import { signOut } from '@/lib/auth-client';

async function handleSignOut() {
  await signOut();
  router.push('/login');
}
```

### 3.8 fetch 携带 cookie

```typescript
// packages/api-client
const client = createClient<paths>({
  baseUrl,
  fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }),
});
```

### 3.9 环境变量

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
BETTER_AUTH_SECRET=<和 packages/auth 相同>
BETTER_AUTH_URL=http://localhost:3001
```

## 验收标准

- [ ] Email/Password 注册 → 邮箱验证（dev 时 console 看链接） → 登录
- [ ] Google OAuth 完整流程
- [ ] GitHub OAuth 完整流程
- [ ] Session 持久化（刷新仍登录）
- [ ] 登出后无法访问受保护页面
- [ ] middleware 重定向规则正确
- [ ] Server Components 能拿到 session
