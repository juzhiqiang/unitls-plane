# 09 - 生成 packages/api-client

> 依赖：03-swagger、07-files-module、08-tasks-module
> 预估：1.5h

## 目标

基于后端 Swagger 自动生成 openapi-fetch 类型安全客户端，供 apps/web 使用。

## 步骤

### 9.1 安装依赖

```bash
cd packages/api-client
bun add openapi-fetch
bun add -d openapi-typescript
```

### 9.2 配置 package.json

```json
{
  "name": "@utils-plane/api-client",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "generate": "openapi-typescript ../../apps/api/openapi.json -o ./src/schema.ts",
    "build": "tsc"
  }
}
```

### 9.3 创建客户端

`packages/api-client/src/index.ts`:

```typescript
import createClient from 'openapi-fetch';
import type { paths } from './schema';

export function createApiClient(
  baseUrl: string,
  getToken?: () => Promise<string | null>
) {
  const client = createClient<paths>({ baseUrl });

  client.use({
    async onRequest({ request }) {
      const token = await getToken?.();
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
  });

  return client;
}

export type { paths, components } from './schema';
```

### 9.4 生成 Schema

```bash
# 1. 在 apps/api 启动并导出 openapi.json
cd apps/api && bun run openapi:export

# 2. 在 packages/api-client 生成类型
cd packages/api-client && bun run generate
```

### 9.5 集成到 Turborepo

`turbo.json` 添加任务依赖：

```json
{
  "tasks": {
    "@utils-plane/api-client#generate": {
      "dependsOn": ["@utils-plane/api#openapi:export"]
    },
    "@utils-plane/api-client#build": {
      "dependsOn": ["generate"]
    }
  }
}
```

### 9.6 使用示例（供 Phase 3 参考）

```typescript
// apps/web 中使用
import { createApiClient } from '@utils-plane/api-client';

const api = createApiClient(process.env.NEXT_PUBLIC_API_URL!, async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
});

const { data, error } = await api.GET('/files/{id}', {
  params: { path: { id: 'xxx' } },
});
// data 已具备完整类型
```

## 验收标准

- [ ] `bun run generate` 生成 schema.ts，所有 endpoints 有类型
- [ ] 客户端调用有完整类型推断
- [ ] 401 错误能正确捕获
- [ ] Bearer token 自动注入
