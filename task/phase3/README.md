# Phase 3: 前端基础搭建

## 任务依赖图

```
          ┌──────────────────┐
          │ 01-nextjs-init   │ ← 必须最先完成
          └────────┬─────────┘
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
    ┌─────┐    ┌─────┐    ┌─────┐
    │ 02  │    │ 03  │    │ 05  │
    │Layot│    │Auth │    │ API │
    └──┬──┘    └─────┘    │Clien│
       │                  └─────┘
       ▼
    ┌─────┐
    │ 04  │
    │Mark │
    └─────┘
```

## 并行执行策略

| 时间段 | 可并行任务                                               |
| ------ | -------------------------------------------------------- |
| T1     | 01-nextjs-init                                           |
| T2     | 02-layout ‖ 03-supabase-auth ‖ 05-api-client-integration |
| T3     | 04-marketing-page (依赖 02)                              |

## 文件列表

| 文件                         | 任务                               | 依赖      | 预估 |
| ---------------------------- | ---------------------------------- | --------- | ---- |
| 01-nextjs-init.md            | Next.js + Tailwind + shadcn 初始化 | Phase 1   | 2h   |
| 02-layout.md                 | 主布局 + 侧边栏 + 响应式           | 01        | 2.5h |
| 03-better-auth-client.md     | Better-Auth 前端集成               | 01, P1-06 | 2.5h |
| 04-marketing-page.md         | 落地页（SEO）                      | 02        | 2h   |
| 05-api-client-integration.md | API Client 封装 + Provider         | 01, P2-09 | 1.5h |

## 前置依赖

- Phase 1 全部完成
- Phase 2 至少完成 09-api-client（用于 05）
