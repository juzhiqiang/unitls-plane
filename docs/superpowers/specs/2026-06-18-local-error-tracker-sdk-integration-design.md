# 本地 Error Tracker SDK 接入设计

## 目标

补齐 Utils-Plane 现有本地 `@error-tracker/sdk` 接入，不扩展到业务级监控埋点。接入应完全由环境变量配置，避免硬编码密钥，并在 Next.js Web 应用和 NestJS API 中保持一致初始化。

## 非目标

- 不在工具页、API client、队列或任务处理器中新增手动业务事件埋点。
- 不把本地 SDK 替换成第三方服务。
- 不修改 SDK 包自身，除非应用接入暴露出阻塞级 SDK 问题。
- 不提交本地密钥或真实生产 token。

## 当前状态

- 工作区已经依赖本地 `@error-tracker/sdk` 包。
- `apps/web/src/components/error-tracker-init.tsx` 会在设置 `NEXT_PUBLIC_ERROR_TRACKER_DSN` 时初始化浏览器 SDK。
- `apps/web/src/app/[locale]/layout.tsx` 已经挂载 `ErrorTrackerInit`。
- `apps/api/src/main.ts` 会在设置 `ERROR_TRACKER_DSN` 时初始化 Node SDK。
- `.env.example`、`PROJECT_SPECS.md` 和 `CLAUDE.md` 已提到 error tracker 变量，但前端 SDK token 目前硬编码在客户端组件里。

## 方案

沿用现有 SDK 入口，并让初始化完全由环境变量驱动。

### Web 端

- 读取 `NEXT_PUBLIC_ERROR_TRACKER_DSN` 和 `NEXT_PUBLIC_ERROR_TRACKER_TOKEN`。
- 缺少 `NEXT_PUBLIC_ERROR_TRACKER_DSN` 时跳过 SDK 初始化。
- 仅在配置了 `NEXT_PUBLIC_ERROR_TRACKER_TOKEN` 时传入 `token`。
- 保留现有默认行为：
  - `environment: process.env.NODE_ENV`
  - `release: process.env.NEXT_PUBLIC_RELEASE ?? 'dev'`
  - `ReplayPlugin({ bufferSeconds: 30, sampleRate: 0.5 })`
- 不额外启动手动定时 flush，依赖 SDK 自带自动上报与页面生命周期 flush 机制。
- 从源码中移除硬编码 token。

### API

- 读取 `ERROR_TRACKER_DSN` 和 `ERROR_TRACKER_TOKEN`。
- 缺少 `ERROR_TRACKER_DSN` 时跳过 SDK 初始化。
- 仅在配置了 `ERROR_TRACKER_TOKEN` 时传入 `token`。
- 保留现有默认行为：
  - `environment: process.env.NODE_ENV`
  - `release: process.env.RELEASE ?? process.env.NEXT_PUBLIC_RELEASE ?? 'dev'`

### 环境变量文档

- 在 `.env.example` 中新增 `NEXT_PUBLIC_ERROR_TRACKER_TOKEN=`。
- 保留 `ERROR_TRACKER_TOKEN=`，用于后端 SDK 和 sourcemap 上传，因为现有文档已经使用这个变量名。
- 如果项目文档列出了前端环境变量但缺少前端 token，同步补充。

## 数据流

1. 浏览器加载 locale 路由。
2. `LocaleLayout` 挂载 `ErrorTrackerInit`。
3. `ErrorTrackerInit` 检查 public 环境变量，并在每个客户端运行时只初始化一次浏览器 SDK。
4. 浏览器 SDK 自动采集错误、未处理 Promise rejection、breadcrumbs、Web Vitals、白屏信号和 replay 采样。
5. API 进程从 `apps/api/src/main.ts` 启动。
6. `main.ts` 加载根目录环境文件，并在 Nest 启动前初始化 Node SDK。
7. Node SDK 自动采集 uncaught exception 和未处理 Promise rejection。

## 错误处理与隐私

- 缺少 DSN 视为关闭监控，不作为应用错误处理。
- 允许缺少 token，因为 SDK 支持可选 `token`，也兼容旧版 token-in-DSN 格式。
- 客户端 token 本质上是公开配置，因为浏览器 SDK 上报需要使用它；但它仍必须来自环境变量，而不是源码硬编码。
- Replay 保持 SDK 默认脱敏策略，本次接入不覆盖 masking 行为。

## 测试

- 新增或更新 Web 测试，覆盖：
  - DSN 存在时只初始化一次
  - 配置 `NEXT_PUBLIC_ERROR_TRACKER_TOKEN` 时会传入 token
  - DSN 缺失时不初始化
  - React StrictMode 下不会重复初始化，也不会启动手动 flush 定时器
- 如果当前 API 测试环境可以在不启动服务器的情况下导入初始化逻辑，则新增聚焦的 API 测试。如果当前结构不适合直接导入，则先抽取一个构建 SDK options 的小型纯函数，并优先测试该函数。

## 验证

- 运行相关 Web 测试文件。
- 运行新增 API 测试，或运行后端改动所需的类型/ lint 检查。
- 执行定向搜索，确认 app 源码中不再残留硬编码 tracker token。
