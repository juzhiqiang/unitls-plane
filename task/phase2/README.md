# Phase 2: 后端服务搭建

## 任务依赖图

```
                  ┌──────────────────┐
                  │ 01-nestjs-init   │ ← 必须最先完成
                  └────────┬─────────┘
                           │
       ┌───────┬───────┬───┴───┬───────┬───────┐
       ▼       ▼       ▼       ▼       ▼       ▼
    ┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐┌─────┐
    │ 02  ││ 03  ││ 04  ││ 05  ││ 06  ││ 08  │
    │CORS ││Swagr││Auth ││Throt││Bull ││Tasks│
    └─────┘└──┬──┘└──┬──┘└─────┘└──┬──┘└──┬──┘
              │      │              │      │
              │      ▼              ▼      │
              │  ┌─────┐         ┌─────┐  │
              │  │ 07  │ ←───────│     │  │
              │  │Files│         └─────┘  │
              │  └──┬──┘                  │
              │     │                     │
              └─────┴──────┬──────────────┘
                           ▼
                       ┌─────┐
                       │ 09  │
                       │ API │
                       │Clien│
                       └──┬──┘
                          │
                          ▼
                      ┌─────┐
                      │ 10  │
                      │Rail │
                      └─────┘
```

## 并行执行策略

| 时间段 | 可并行任务 |
|--------|----------|
| T1 | 01-nestjs-init |
| T2 | 02-cors-exception ‖ 03-swagger ‖ 04-auth-guard ‖ 05-throttler ‖ 06-bullmq ‖ 08-tasks-module |
| T3 | 07-files-module（依赖 04, Phase 1 supabase）|
| T4 | 09-api-client（依赖 03, 07, 08）|
| T5 | 10-railway-deploy（依赖全部）|

## 文件列表

| 文件 | 任务 | 依赖 | 预估 |
|------|------|------|------|
| 01-nestjs-init.md | 初始化 NestJS + Bun | Phase 1 | 2h |
| 02-cors-exception.md | CORS + Exception Filters | 01 | 1h |
| 03-swagger.md | Swagger 自动文档 | 01 | 1h |
| 04-auth-guard.md | Supabase JWT Auth Guard | 01 | 2h |
| 05-throttler.md | Rate Limiting | 01, P1-06 | 1.5h |
| 06-bullmq.md | BullMQ 集成 | 01, P1-06 | 2h |
| 07-files-module.md | 文件上传/下载模块 | 04, P1-05 | 3h |
| 08-tasks-module.md | 任务 CRUD 模块 | 01, P1-03 | 2.5h |
| 09-api-client.md | 生成 openapi-fetch 客户端 | 03, 07, 08 | 1.5h |
| 10-railway-deploy.md | Railway 部署配置 | 全部 | 1.5h |

## 前置依赖

需要 Phase 1 全部完成：
- packages/db 可用
- packages/validators 可用
- Supabase 已配置（DATABASE_URL, SUPABASE_*）
- Upstash Redis 已配置（UPSTASH_REDIS_URL, TOKEN）
