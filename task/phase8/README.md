# Phase 8: PDF 工具扩展

## 任务依赖图

```
通用变更（必须先完成）
┌──────────────────────────┐
│ 00-pdf-schema-update     │  ← DB 枚举 + Validators + DTO + 路由
└─────────────┬────────────┘
              │
              ▼
┌───────────────────────────────────────────────────────────────────────┐
│  以下全部可并行                                                       │
│                                                                       │
│  01-pdf-to-text     ← PDF → Markdown / 纯文本（核心需求）             │
│  02-image-to-pdf    ← 图片 → PDF                                     │
│  03-pdf-rotate      ← 页面旋转                                       │
│  04-pdf-watermark   ← 加水印                                         │
│  05-pdf-encrypt     ← 加密/设置密码                                   │
│  06-pdf-compress    ← PDF 压缩                                       │
│  07-pdf-metadata    ← 元数据编辑                                      │
│  08-pdf-rearrange   ← 页面重排/删除                                   │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────┐
│ 09-pdf-ui-update         │  ← PDF 首页入口 + 国际化 + 结果预览组件
└──────────────────────────┘
```

## 并行执行策略

| 时间段 | 可并行任务                                                                        |
| ------ | --------------------------------------------------------------------------------- |
| T0     | 00-pdf-schema-update（前置，必须先完成）                                           |
| T1     | 01 ‖ 02 ‖ 03 ‖ 04 ‖ 05 ‖ 06 ‖ 07 ‖ 08（全部并行，各自独立 Service + Processor + UI） |
| T2     | 09-pdf-ui-update（依赖 01-08 全部完成）                                            |

## 文件列表

| 文件                     | 任务                             | 依赖  | 预估 |
| ------------------------ | -------------------------------- | ----- | ---- |
| 00-pdf-schema-update.md  | DB 枚举 + Validators + DTO 扩展 | Phase 5 | 1h   |
| 01-pdf-to-text.md        | PDF → Markdown / 纯文本         | 00    | 3h   |
| 02-image-to-pdf.md       | 图片 → PDF                      | 00    | 2h   |
| 03-pdf-rotate.md         | PDF 页面旋转                     | 00    | 2h   |
| 04-pdf-watermark.md      | PDF 加水印                       | 00    | 3h   |
| 05-pdf-encrypt.md        | PDF 加密                         | 00    | 2h   |
| 06-pdf-compress.md       | PDF 压缩                         | 00    | 3h   |
| 07-pdf-metadata.md       | PDF 元数据编辑                   | 00    | 1.5h |
| 08-pdf-rearrange.md      | PDF 页面重排/删除                | 00    | 2.5h |
| 09-pdf-ui-update.md      | 首页入口 + 国际化 + 预览组件     | 01-08 | 2h   |

## 前置依赖

- Phase 5 全部完成（PDF 合并/拆分/转图片 + 字体 已就绪）
- 已有 `mupdf@1.27.0`、`pdf-lib@1.17.1`、`pdfjs-dist@5.7.284`

## 新增依赖

- `apps/api`: `turndown` + `@types/turndown`
- `apps/web`: `react-markdown`
