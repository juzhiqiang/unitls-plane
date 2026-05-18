# Phase 5: PDF + 字体工具

## 任务依赖图

```
PDF 子系统                              字体子系统
┌─────────────────┐                  ┌─────────────────┐
│ 01-pdf-merge    │                  │ 05-font-server  │
│ 02-pdf-split    │  ← 服务端处理    │  (转换 service) │
│ (服务端)        │                  └────────┬────────┘
└────────┬────────┘                           │
         │                                    ▼
         ▼                          ┌─────────────────┐
┌─────────────────┐                 │ 06-font-preview │
│ 03-pdf-preview  │ ← 前端预览       │  (前端预览组件) │
│  (pdfjs-dist)   │                  └────────┬────────┘
└────────┬────────┘                           │
         │                                    ▼
         ▼                          ┌─────────────────┐
┌─────────────────┐                 │ 07-font-ui      │
│ 04-pdf-ui       │                 │  (前端页面)     │
│  (前端页面)     │                 └─────────────────┘
└─────────────────┘
```

## 并行执行策略

| 时间段 | 可并行任务                                                    |
| ------ | ------------------------------------------------------------- |
| T1     | 01-pdf-merge ‖ 02-pdf-split ‖ 03-pdf-preview ‖ 05-font-server |
| T2     | 06-font-preview (依赖 05)                                     |
| T3     | 04-pdf-ui (依赖 01, 02, 03) ‖ 07-font-ui (依赖 06)            |

## 文件列表

| 文件               | 任务                          | 依赖       | 预估 |
| ------------------ | ----------------------------- | ---------- | ---- |
| 01-pdf-merge.md    | PDF 合并 Processor            | Phase 2    | 2h   |
| 02-pdf-split.md    | PDF 拆分 Processor            | Phase 2    | 2h   |
| 03-pdf-preview.md  | PDF 预览组件（pdfjs-dist）    | Phase 3    | 2h   |
| 04-pdf-ui.md       | PDF 工具 UI（合并/拆分/重排） | 01, 02, 03 | 4h   |
| 05-font-server.md  | 字体转换 Processor            | Phase 2    | 3h   |
| 06-font-preview.md | 字体预览组件                  | Phase 3    | 1.5h |
| 07-font-ui.md      | 字体工具 UI                   | 06         | 2h   |

## 前置依赖

- Phase 2 全部完成
- Phase 3 全部完成
- Phase 4 完成（复用 progress-poll、file-dropzone 等）
