# 05 - API Client 集成

> 依赖：01-nextjs-init、Phase 2 / 09-api-client
> 预估：1.5h
> 可并行：与 02/03 同时执行

## 目标

在前端封装 `@utils-plane/api-client`，集成 React Query 提供数据获取/缓存能力。

## 步骤

### 5.1 安装依赖

```bash
cd apps/web
bun add @tanstack/react-query @utils-plane/api-client
bun add -d @tanstack/react-query-devtools
```

### 5.2 创建 QueryProvider

`src/components/providers/query-provider.tsx`:

```tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

### 5.3 创建 API Client 实例

`src/lib/api-client.ts`:

```typescript
import { createApiClient } from '@utils-plane/api-client';
import { createClient } from './supabase/client';

export const api = createApiClient(
  process.env.NEXT_PUBLIC_API_URL!,
  async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }
);
```

服务端版本 `src/lib/api-client-server.ts`：

```typescript
import { createApiClient } from '@utils-plane/api-client';
import { createClient } from './supabase/server';

export async function getApiClient() {
  return createApiClient(process.env.NEXT_PUBLIC_API_URL!, async () => {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  });
}
```

### 5.4 创建通用 hooks

`src/hooks/api/use-files.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useFiles(query?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['files', query],
    queryFn: async () => {
      const { data, error } = await api.GET('/files', { params: { query } });
      if (error) throw error;
      return data;
    },
  });
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const { data, error } = await api.POST('/files/upload', {
        body: formData as any,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  });
}
```

类似创建 `use-tasks.ts`。

### 5.5 集成到根 layout

`src/app/layout.tsx`:

```tsx
import { QueryProvider } from '@/components/providers/query-provider';
import { Toaster } from '@/components/ui/sonner';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ThemeProvider>
          <QueryProvider>
            {children}
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### 5.6 错误处理 + Toast

创建 `src/lib/api-error.ts`:

```typescript
import { toast } from 'sonner';

export function handleApiError(error: any) {
  const code = error?.code ?? 'UNKNOWN';
  const message = error?.message ?? 'Something went wrong';

  toast.error(message, {
    description: code !== 'UNKNOWN' ? `Code: ${code}` : undefined,
  });
}
```

在 QueryProvider 配置全局 onError。

### 5.7 环境变量

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## 验收标准

- [ ] api.GET/POST 等方法有完整类型推断
- [ ] React Query DevTools 可见
- [ ] 401 错误正确触发（token 过期）
- [ ] Toast 错误提示工作
- [ ] 服务端组件能调用 API
