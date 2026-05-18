# Phase 4: 图片工具 MVP

## 任务依赖图

```
   ┌────────────────────┐  ┌────────────────────┐
   │ 01-client-compress │  │ 02-server-processor│
   │  (前端 lib)        │  │  (Sharp + Bull)    │
   └─────────┬──────────┘  └────────┬───────────┘
             │                       │
             │                       ▼
             │           ┌────────────────────┐
             │           │ 03-format-convert  │
             │           │  (服务端格式转换)   │
             │           └────────┬───────────┘
             │                    │
             └────────┬───────────┘
                      ▼
             ┌────────────────────┐
             │ 04-image-ui        │
             │  (拖拽/配置/预览)  │
             └────────┬───────────┘
                      │
                      ▼
             ┌────────────────────┐
             │ 05-progress-poll   │
             │  (进度轮询 hook)   │
             └────────────────────┘
```

## 并行执行策略

| 时间段 | 可并行任务                                                  |
| ------ | ----------------------------------------------------------- |
| T1     | 01-client-compress ‖ 02-server-processor ‖ 05-progress-poll |
| T2     | 03-format-convert (依赖 02)                                 |
| T3     | 04-image-ui (依赖 01, 03, 05)                               |

## 文件列表

| 文件                   | 任务                               | 依赖         | 预估 |
| ---------------------- | ---------------------------------- | ------------ | ---- |
| 01-client-compress.md  | 客户端图片压缩 lib                 | Phase 3      | 2h   |
| 02-server-processor.md | Sharp Processor + Service          | Phase 2      | 3h   |
| 03-format-convert.md   | 图片格式转换                       | 02           | 2h   |
| 04-image-ui.md         | 图片工具 UI（拖拽/配置/预览/对比） | 01, 03, 05   | 4h   |
| 05-progress-poll.md    | 任务进度轮询 hook                  | Phase 2 / 08 | 1h   |

## 前置依赖

- Phase 2 全部完成（特别是 tasks-module、bullmq）
- Phase 3 全部完成（特别是 api-client-integration）
