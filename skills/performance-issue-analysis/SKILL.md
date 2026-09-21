---
name: performance-issue-analysis
description: Use when Utils-Plane feels slow, laggy, or times out — 任务排队久、队列积压、内存飙升/OOM、列表加载慢、上传/下载慢、页面卡死掉帧、CPU 打满、performance/slow/latency/timeout/memory leak;涉及 BullMQ 任务、sharp/mupdf/LibreOffice/ONNX、MinIO、Drizzle 列表或浏览器本地图片处理。
---

# 性能问题分析

## 概览

**核心原则:没有测量数据不许优化;先定位是哪一层慢,再单变量验证。**

本项目的性能几乎都是「层」的问题。改任何东西前,先确定慢/内存落在下面哪一层,只对最慢的那一层动手:

浏览器主线程 vs Web Worker → API 请求 → 2 宽任务队列 → 全内存处理管道 → PostgreSQL → MinIO → 外部进程(LibreOffice/ONNX)。

猜「这里肯定慢」然后直接改,是失败。先量,再定位,再验证。

## 测量优先

1. **复现并量化**:慢多少?每次都慢还是偶发?输入多大(文件大小、页数、图片数)?登录态还是匿名?没有数字就先拿到数字。
2. **分层加证据**,一层一个手段:
   - 前端:DevTools Performance 录一段,看主线程火焰图和长任务;确认重活是否真在 Worker 里(见症状表)。
   - 上传内存:设 `PERFORMANCE_MEMORY_LOG=true`,上传完会打内存指标。
   - 队列:`/admin/queues` 看积压、job 耗时、失败重试;区分「排队等」和「跑得慢」。
   - DB:对可疑查询跑 `EXPLAIN ANALYZE`,确认走了索引不是全表扫。
   - 容器:`docker stats` 看 API/依赖的 CPU、内存曲线。
3. **只往最慢的单一层里查**,不要同时改多处。

## 分层症状对照表

| 症状 | 可能瓶颈层 | 检查方式 | 已知基线 / 修复方向 |
|---|---|---|---|
| 任务迟迟不开始、排队久 | 2 宽队列漏斗 | `/admin/queues` 看是不是慢任务堵快任务;`apps/api/src/modules/tasks/task-queue.ts`(19 类型压 4 队列) | 慢的 `pdf_to_cad`/`pdf_compress` 会堵住同队列的 `pdf_rotate`;并发在 `apps/api/src/config/worker-concurrency.ts`,可调 `*_WORKER_CONCURRENCY`,别默认就加 |
| 单个图片/PDF 任务内存飙升/OOM | 全内存管道 | `PERFORMANCE_MEMORY_LOG`;确认不是超大输入 | 所有处理都是 `download()→Buffer→内存→upload()`,无流式(`apps/api/src/modules/files/minio.service.ts` 故意缓冲,Bun 死锁 workaround);压缩类先看 `image.service.ts` 的 `compressToTargetSize()` 重复 encode |
| PDF 转图 / 压缩慢 | mupdf 逐页热循环 | 看 job 耗时随页数线性涨 | `apps/api/src/modules/tasks/services/pdf.service.ts` 的 `handleToImage`/`compressPdf` 逐页 rasterize,全内存 |
| Markdown/DOCX 转 PDF 偶发很慢或超时 | LibreOffice 外部进程 | job 卡在 `pdf_from_document`;120s 超时 | `pdf.service.ts` 的 `documentToPdf` 每次 spawn soffice,串行在 2 槽队列 |
| 证件照 / 抠图慢 | ONNX 推理串行 | id-photo 任务耗时高 | `portrait-segmentation.service.ts` 逐像素张量 + 单会话串行;前端 RMBG 无 WebGPU 时回退 wasm 极重(`apps/web/src/lib/id-photo-local/segmentation.ts`) |
| 浏览器页面卡死 / 掉帧 | 重活跑在主线程 | DevTools 长任务;查是否有 `OffscreenCanvas` | `apps/web/src/lib/processing/image-worker-client.ts` 的 `runInImageWorker` 无 OffscreenCanvas 时回退主线程;GIF/APNG(`image-animation-client.ts`)、拼图最重 |
| 文件 / 任务列表加载慢 | DB 分页 / 索引 | `EXPLAIN ANALYZE` | 确认走游标 + `includeTotal=false`(`apps/api/src/modules/files/files.service.ts`、`tasks.service.ts`),没退回 `COUNT(*)` 或深 offset;文件名 `%term%` 搜索必须命中 `files_filename_trgm_idx`(`packages/db/src/schema/files.ts`) |
| 批量删除 / 清空回收站慢 | 逐条事务未批量 | 观察随记录数线性变慢 | `files.service.ts` 的 `batchPermanentDelete`/`emptyTrash`/`cleanupRecords` 逐条 `FOR UPDATE` + 单独 MinIO 往返 |
| 账号摘要相关慢 / 抖动 | 缓存未命中或降级 | 查 Redis 是否可用 | 进程内 2s 缓存 + Redis 跨实例层(`apps/api/src/common/cache/account-summary-redis.ts`),超时极短、故障静默回退 DB |
| `/health/ready` 慢 | 探针超时 / spawn | 看哪个 check 慢 | 每探针 `AbortController` + 3s 超时并行;`libreoffice-health.ts` 每次都 spawn `soffice --version` |

## 假设与单变量验证

- 一次只改一个变量。改前记下 baseline 数字,改后对比**同一**指标。
- 没提升就回滚,别在上面叠加第二个改动。
- 拿不准就说「我不确定哪层慢」,回去补测量,不要硬猜。

## 红旗——停下来重新测量

- 「这里肯定慢」但没有数字
- 一次改多处 / 同时加缓存又加并发
- 拿开发环境冷启动、首次编译当性能数据
- 只看 source map 不看真实负载
- 把已有的「已知良好基线」当新点子重复实现(游标分页、trgm 索引、有界缓存、Worker offload)
- 为一个还没测出来的瓶颈提前加缓存/并发

## 验证清单

声明「性能已改善」前必须确认:

- [ ] 有改前 / 改后的**同指标**数字,复现场景一致
- [ ] 相关测试通过,没引入功能回归
- [ ] 内存 / 队列在负载下稳定,不是只跑一次好看
- [ ] 没绕过或破坏已知良好基线(游标分页、`includeTotal=false`、trgm 索引、有界解码缓存、Worker offload)
- [ ] 改的是最慢的那一层,不是顺手动了别处

## 说明

本项目无遥测 / APM / 错误追踪,性能分析只依赖现有手段:日志、`PERFORMANCE_MEMORY_LOG`、`/admin/queues`、`docker stats`、DevTools、`EXPLAIN ANALYZE`。已知良好基线的事实源是 `PROJECT_SPECS.md` 的「性能优化接口约定」小节,症状表与其保持一致。
