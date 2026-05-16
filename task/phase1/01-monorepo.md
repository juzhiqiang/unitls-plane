# 01 - 初始化 Turborepo + Bun Workspace

> 依赖：无
> 预估：2h
> 可并行：与 05-supabase、06-upstash 同时执行

## 目标

创建 monorepo 骨架，所有 apps 和 packages 能被 Turborepo 识别并正确解析。

## 步骤

### 1.1 创建根目录结构

```bash
mkdir -p apps/web apps/api packages/db packages/validators packages/api-client packages/utils
```

### 1.2 初始化根 package.json

```json
{
  "name": "utils-plane",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "clean": "turbo clean"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5.7"
  }
}
```

### 1.3 配置 turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

### 1.4 各 package 初始化 package.json

每个 `packages/*` 和 `apps/*` 下创建基础 `package.json`：

- `packages/db` → `@utils-plane/db`
- `packages/validators` → `@utils-plane/validators`
- `packages/api-client` → `@utils-plane/api-client`
- `packages/utils` → `@utils-plane/utils`
- `apps/web` → `@utils-plane/web`
- `apps/api` → `@utils-plane/api`

### 1.5 安装依赖 & 验证

```bash
bun install
bunx turbo build --dry
```

## 验收标准

- [ ] `bun install` 无报错
- [ ] `bunx turbo build --dry` 能识别所有 workspace
- [ ] 目录结构符合设计文档
