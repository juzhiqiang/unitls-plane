# 05 - 配置 Supabase 项目

> 依赖：无（外部配置，可最先开始）
> 预估：1h
> 可并行：与所有任务并行

## 目标

在 Supabase 创建项目，配置 Auth、Database、Storage，获取连接凭证。

## 步骤

### 5.1 创建 Supabase 项目

1. 登录 https://supabase.com/dashboard
2. 创建新项目：`utils-plane`
3. 选择区域（推荐：Northeast Asia / Singapore）
4. 记录 Database Password

### 5.2 获取连接信息

从 Project Settings → API 获取：

```env
# .env.local (根目录模板)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

### 5.3 配置 Auth

1. Authentication → Providers：
   - 启用 Email/Password
   - 启用 Google OAuth（配置 Client ID/Secret）
   - 启用 GitHub OAuth（配置 Client ID/Secret）

2. Authentication → URL Configuration：
   - Site URL: `http://localhost:3000`（开发）
   - Redirect URLs: `http://localhost:3000/api/auth/callback`

### 5.4 配置 Storage

1. Storage → Create Bucket：
   - Bucket name: `uploads`
   - Public: false
   - File size limit: 50MB
   - Allowed MIME types: `image/*, application/pdf, font/*`

2. Storage → Policies：
   - 登录用户可上传到 `uploads/{user_id}/`
   - 登录用户可读取自己的文件
   - Service role 可读写所有文件（后端用）

### 5.5 创建 .env 模板

在根目录创建 `.env.example`：

```env
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# Upstash Redis (see 06-upstash)
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=
```

创建 `.gitignore` 确保 `.env*local` 不被提交。

## 验收标准

- [ ] Supabase 项目已创建
- [ ] Auth providers 已配置（Email + Google + GitHub）
- [ ] Storage bucket `uploads` 已创建并配置策略
- [ ] `.env.example` 已创建
- [ ] 本地 `.env.local` 已填入真实凭证
- [ ] 能通过 DATABASE_URL 连接数据库
