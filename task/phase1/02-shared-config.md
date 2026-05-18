# 02 - 共享 TypeScript / ESLint / Prettier 配置

> 依赖：01-monorepo
> 预估：1.5h
> 可并行：完成后解锁 03-db 和 04-validators

## 目标

统一所有 apps/packages 的 TS 编译选项、代码风格和 lint 规则。

## 步骤

### 2.1 根目录 tsconfig.json (base)

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": false,
    "noUncheckedIndexedAccess": true
  }
}
```

### 2.2 apps/web/tsconfig.json

继承根配置，添加 Next.js 特有选项：

- `"jsx": "preserve"`
- `"module": "esnext"`
- `"moduleResolution": "bundler"`
- Next.js plugin

### 2.3 apps/api/tsconfig.json

继承根配置，添加 NestJS/Bun 选项：

- `"module": "esnext"`
- `"moduleResolution": "bundler"`
- `"target": "esnext"`
- `"emitDecoratorMetadata": true`
- `"experimentalDecorators": true`

### 2.4 ESLint 配置 (eslint.config.mjs)

使用 flat config 格式：

- `@typescript-eslint/eslint-plugin`
- `eslint-plugin-import`
- 各 app 可扩展（Next.js 用 `eslint-config-next`）

### 2.5 Prettier 配置 (.prettierrc)

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### 2.6 安装依赖

```bash
bun add -d -w eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier eslint-config-prettier
```

## 验收标准

- [ ] 各 workspace 的 `tsc --noEmit` 无报错
- [ ] `bunx eslint .` 无报错
- [ ] `bunx prettier --check .` 无报错
