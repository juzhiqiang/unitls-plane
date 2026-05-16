# 01 - 初始化 NestJS + Bun

> 依赖：Phase 1 完成
> 预估：2h
> 阻塞：所有 Phase 2 后续任务

## 目标

在 `apps/api` 创建 NestJS 项目，使用 Bun 作为运行时和包管理器。

## 步骤

### 1.1 创建 NestJS 项目

```bash
cd apps/api
bun add @nestjs/core @nestjs/common @nestjs/platform-express reflect-metadata rxjs
bun add -d @nestjs/cli typescript @types/node
```

### 1.2 package.json

```json
{
  "name": "@utils-plane/api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "bun --hot src/main.ts",
    "build": "nest build",
    "start": "bun dist/main.js",
    "lint": "eslint src/"
  }
}
```

### 1.3 创建入口文件

`apps/api/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
```

`apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
})
export class AppModule {}
```

### 1.4 tsconfig.json

继承根 tsconfig，添加：
- `emitDecoratorMetadata: true`
- `experimentalDecorators: true`
- `target: "esnext"`
- `module: "esnext"`
- `moduleResolution: "bundler"`

### 1.5 验证启动

```bash
bun dev
# 访问 http://localhost:3001
```

## 验收标准

- [ ] `bun dev` 启动无报错
- [ ] 访问 `http://localhost:3001` 返回 404（正常，没有路由）
- [ ] `bun --hot` 热重载工作正常
