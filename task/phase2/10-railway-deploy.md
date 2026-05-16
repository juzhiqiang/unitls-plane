# 10 - Railway 部署

> 依赖：Phase 2 全部任务
> 预估：1.5h

## 目标

将 apps/api 部署到 Railway，配置环境变量与自动构建。

## 步骤

### 10.1 创建 Dockerfile

`apps/api/Dockerfile`:
```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# 安装系统依赖（Sharp 等 native libs）
RUN apt-get update && apt-get install -y \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制 monorepo 文件
COPY package.json bun.lock turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/validators/package.json packages/validators/
COPY packages/utils/package.json packages/utils/

# 安装依赖
RUN bun install --frozen-lockfile

# 复制源码
COPY . .

# 构建
RUN bun run build --filter=@utils-plane/api

EXPOSE 3001
CMD ["bun", "apps/api/dist/main.js"]
```

### 10.2 创建 railway.json

`apps/api/railway.json`:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "apps/api/Dockerfile"
  },
  "deploy": {
    "startCommand": "bun apps/api/dist/main.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

### 10.3 健康检查端点

`apps/api/src/modules/health/health.controller.ts`:
```typescript
@Controller('health')
@Public()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

### 10.4 Railway 配置

1. https://railway.app → New Project → Deploy from GitHub
2. 选择本仓库
3. Root Directory: `/` (monorepo 根)
4. 配置环境变量：
   - `DATABASE_URL` (Supabase pooler URL)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `UPSTASH_REDIS_URL`
   - `UPSTASH_REDIS_TOKEN`
   - `CORS_ORIGIN` (前端域名)
   - `PORT=3001`
   - `NODE_ENV=production`

### 10.5 配置自定义域名（可选）

Railway Settings → Networking → Generate Domain 或绑定自有域名。

### 10.6 验证部署

```bash
curl https://<railway-domain>/health
# { "status": "ok", ... }

curl https://<railway-domain>/docs
# Swagger UI HTML
```

## 验收标准

- [ ] Railway 自动从 GitHub main 分支部署成功
- [ ] /health 返回 200
- [ ] /docs 可访问
- [ ] Sharp 等 native 依赖正常工作（上传测试图片）
- [ ] 日志中无错误
