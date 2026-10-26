# B：文件与存储优化

> 返回 [三人并行总控](./README.md)。本批只改
> `apps/api/src/modules/files/**`、对应测试和本批新增环境变量。分支：`codex/perf-files-storage`，预估 3–4 天。

## 一、目标与边界

| 目标                     | 当前事实                                                    | 本批结果                                              |
| ------------------------ | ----------------------------------------------------------- | ----------------------------------------------------- |
| 大文件上传不整文件进内存 | Bun 下 `uploadStream()` 收集全部 chunk 后 `Buffer.concat()` | Node 生产路径使用 multipart；Bun 保留 Buffer fallback |
| 大文件下载可落盘         | 只有整文件 `download(): Buffer`                             | 新增流式 `downloadToFile()`                           |
| 缩略图只生成一次         | 每次 `/thumbnail` 都下载原图并执行 Sharp                    | 生成后写入 MinIO，后续直接命中                        |
| 304 真正省掉生成成本     | 有 ETag，但未处理 `If-None-Match`                           | 命中时在读取原图前返回 304                            |
| 并发请求不重复解码       | 无 single-flight                                            | 同进程同文件同时只生成一次                            |

**不在本批范围**

- 不新增数据库列、不新增 migration、不新增队列任务。
- 不改上传文件大小额度、MIME 白名单和访问控制规则。
- 不改 `tasks.module.ts`、processor 和 Worker 启动方式；这些归 C。
- 不处理软删除文件的缩略图生命周期清理，只记录后续方案。
- 不承诺 Bun 路径具备与 Node multipart 相同的低内存表现。

## 二、代码入口与基线

| 文件                                             | 现状                                                                  | 本批动作                                              |
| ------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------- |
| `apps/api/src/modules/files/minio.service.ts`    | Bun 兼容 Buffer 上传；有 `downloadStream()`；有 `probeObjectExists()` | 增加 runtime 模式、multipart 上传、`downloadToFile()` |
| `apps/api/src/modules/files/files.service.ts`    | `thumbnail(storageKey)` 每次重新生成                                  | 改为持久化缩略图 + single-flight                      |
| `apps/api/src/modules/files/files.controller.ts` | 设置 `ETag`/`Cache-Control`，未判断条件请求                           | 增加 `If-None-Match` 和 304                           |
| `apps/api/src/modules/files/thumbnail.util.ts`   | 320px WebP quality 70，源文件上限 32 MB                               | 增加版本常量/对象键工具，保持图像参数                 |
| `apps/api/src/modules/files/upload-temp-file.ts` | 已有上传临时文件创建与清理                                            | 复用其安全边界，不另写临时文件工具                    |
| `apps/api/test/modules/files/**`                 | 已有 service/controller/minio/thumbnail 测试                          | 增加新路径测试                                        |
| `apps/api/package.json`、`bun.lock`              | 未安装 `@aws-sdk/lib-storage`                                         | 仅增加 multipart 所需依赖                             |

### D0 基线记录

1. 用生产 Node 路径跑一次 50 MB 和 250 MB 上传，记录请求前、峰值、请求后 RSS。
2. 记录一次 250 MB 下载的 RSS 峰值。
3. 记录缩略图冷请求耗时、二次请求耗时、Sharp 调用次数和原图 GET 次数。
4. 记录当前 `ETag` 响应头格式和 `If-None-Match` 的实际行为。
5. 保留测试文件到本地 `artifacts/`，不提交大文件。

> 生产镜像执行 `node apps/api/dist/main.js`，所以内存验收必须用 Node。`bun src/main.ts` 的 Buffer
> fallback 只能用于本地兼容性验证，不能拿来证明 250 MB 上传已降内存。

## 三、D0 接口契约

以下签名在动工前冻结，C 可按此编码：

```ts
uploadStream(
  key: string,
  source: Readable,
  size: number,
  mimeType: string,
  signal?: AbortSignal
): Promise<void>;

downloadToFile(
  key: string,
  destPath: string,
  signal?: AbortSignal
): Promise<void>;

type MinioUploadMode = 'auto' | 'multipart' | 'buffer';
// 环境变量：MINIO_UPLOAD_MODE，默认 auto
```

## 四、实施步骤

### B1. Node multipart 上传，Bun 保留 Buffer

1. 在 API 包增加 `@aws-sdk/lib-storage`，用其 `Upload` 实现 multipart。
2. 增加 `MINIO_UPLOAD_MODE` 解析与校验：
   - `auto`：Node 走 multipart，Bun 走现有 Buffer；
   - `multipart`：强制 multipart；Bun 下直接给出明确错误，不静默死锁；
   - `buffer`：强制走现有 Buffer，作为线上回退开关。
3. multipart 参数先固定为分块 `8 MiB`、并发队列 `2`、失败不保留分片；这两个值让常驻缓冲约 16
   MiB 级别，后续再按压测调整。
4. 保留 `uploadStream()` 签名和现有调用方。上传前仍校验 `size`，结束时再次核对字节数。
5. `AbortSignal` 必须覆盖整个 multipart 生命周期；超时或调用方取消时调用
   `Upload.abort()`，并销毁源流。
6. 失败、成功都输出不带密钥的日志，至少包含 key、模式、字节数和耗时；不要打印文件内容。
7. 不改 `FilesService.upload()` 的临时文件上传路径，继续使用 `openVerifiedTempUpload()` 的
   `O_NOFOLLOW` 和长度校验。

**说明**：当前 Bun SDK 对 Node `Readable` 的流式 PUT 有死锁规避逻辑，不能为了代码统一删除 Buffer
fallback。Node 生产路径才承担 250 MB 验收。

### B2. `downloadToFile()` 流式落盘

1. 使用 `GetObjectCommand` 获取流，写入目标目录内的唯一临时文件，例如
   `${destPath}.part-${randomUUID()}`。
2. 用 `pipeline(source, writeStream, { signal })` 落盘。目标临时文件和写入流都应设置最小必要权限。
3. 若响应带 `ContentLength`，将实际落盘字节数与它比较；不一致立即失败。
4. 成功后原子 `rename` 到 `destPath`；任何下载、写入、中止或长度错误都要删除临时文件。
5. 不覆盖仍被其他任务使用的文件由调用方负责；本方法只保证单次调用的临时文件隔离和原子替换。
6. 不要用 `download(): Buffer` 实现 `downloadToFile()`，否则峰值内存问题原样保留。

**验收**：250 MB 对象下载时进程 RSS 不随文件大小线性增长；中止后目标目录没有 `.part-*` 残留。

### B3. 缩略图持久化

D0 已冻结的对象与缓存约定：

| 项目     | 约定                                               |
| -------- | -------------------------------------------------- |
| 对象键   | `thumbnails/<fileId>/<THUMBNAIL_VERSION>-320.webp` |
| ETag     | `"thumb-<fileId>-320-<THUMBNAIL_VERSION>"`         |
| 条件请求 | `If-None-Match` 命中返回 `304`                     |
| 缓存头   | `private, max-age=86400`                           |
| 数据库   | 不新增列、不 migration                             |
| 队列     | 不新增缩略图任务                                   |

实施顺序：

1. 在 `thumbnail.util.ts` 增加 `THUMBNAIL_VERSION` 和对象键/ETag 构造函数。版本先从 `1` 开始。
2. Controller 先用 `file.id` 计算强 ETag 和对象键；读取 `If-None-Match`。命中时设置
   `ETag`、`Cache-Control`，返回 304 空响应，**不能调用 FilesService 缩略图方法**。
3. `If-None-Match` 需支持：
   - 单个 ETag；
   - 逗号分隔的多个 ETag；
   - `*`；
   - 弱 ETag 的兼容处理与实际生成的强 ETag 比较。
4. 未命中时调用 `FilesService.thumbnail(file)`。服务层先 `probeObjectExists(thumbKey)`：
   - 命中：读取已存缩略图并返回，不访问原图；
   - 未命中：读取原图流，执行 `renderThumbnail()`，写回缩略图对象后返回。
5. `thumbnail.util.ts` 的 320px、WebP quality 70、32 MB 源文件上限保持不变。`THUMBNAIL_VERSION`
   只在这些参数变化时递增。
6. 在 `FilesService` 增加 `Map<string, Promise<Buffer>>` 作为 single-flight，按 `file.id`
   去重。并发请求中只有一个请求生成/上传，其余等待同一 Promise；无论成功失败都在 `finally`
   删除 Map 项。
7. 缩略图写回失败时不要丢弃刚生成的图片：记录告警并直接把 buffer 返回给调用方，下一次请求再尝试持久化。
8. 访问控制不放松：仍然先 `getById(id, user?.id)`，再判断 MIME/大小，不能直接按对象键提供匿名读取。
9. 不新增缩略图队列任务，避免修改 C 所有的
   `tasks.module.ts`。多实例同时冷启动最多重复生成一次，可以接受，不引入分布式锁。
10. 在代码注释和后续任务中记录：软删除/永久删除暂不清理
    `thumbnails/`，后续统一做前缀生命周期或批处理清理，避免本批扩大范围。

**验收**：同一文件第二次请求不调用 Sharp、不读取原图；携带匹配 `If-None-Match`
时在下载原图前返回 304；10 个并发冷请求只产生 1 次 render 和 1 次缩略图上传。

## 五、测试清单

```powershell
bun --cwd apps/api test test/modules/files
bun --cwd apps/api lint
bun --cwd apps/api build
bun run format:check:changed
```

新增/补充测试至少覆盖：

1. `MINIO_UPLOAD_MODE` 的 `auto`/`multipart`/`buffer` 解析和非法值。
2. Node auto 走 multipart、Bun auto 走 Buffer（用环境/运行时探针 mock，不启动真实 MinIO）。
3. multipart 超时、调用方 abort、上传失败时 `Upload.abort()` 和源流销毁。
4. `downloadToFile()` 成功原子落盘、长度不符、流错误、abort 均清理 `.part-*`。
5. 缩略图对象键和 ETag 包含 `THUMBNAIL_VERSION`。
6. `If-None-Match` 单个、多个、`*`、弱 ETag、不匹配五种情况。
7. 304 路径不调用 `downloadStream()` 和 `renderThumbnail()`。
8. 缓存命中不调用 Sharp；缓存未命中生成一次并 upload。
9. 并发同一 `file.id` 只执行一次 render；不同文件可以并行。
10. 缩略图 upload 失败时仍返回图片，并清理 single-flight。
11. 既有缩略图访问控制测试不回归：公开文件可访问，私有文件仍要求合法用户。

手工验收：

- 上传一个 50 MB 和一个 250 MB 文件，记录 Node RSS 峰值。
- 下载 250 MB 文件，记录 RSS 峰值和临时文件清理。
- 同一缩略图连续请求 3 次，检查第 2、3 次无 Sharp、无原图 GET。
- `curl -I` 和 `curl -H "If-None-Match: ..."` 验证 200/304、`Cache-Control`、`ETag`。
- 清除缩略图对象后再次请求，确认自动重建。

## 六、验收标准

| 指标         | 通过条件                                                    |
| ------------ | ----------------------------------------------------------- |
| 250 MB 上传  | Node 峰值 RSS 增量控制在 128 MiB 内，且不随文件大小线性翻倍 |
| 250 MB 下载  | 流式落盘，峰值 RSS 不随文件大小线性增长                     |
| 缩略图冷请求 | 原图下载 + Sharp 各 1 次，缩略图对象写入 1 次               |
| 缩略图热请求 | Sharp 0 次、原图 GET 0 次                                   |
| 条件请求     | 匹配 `If-None-Match` 返回 304，响应体为空                   |
| 并发         | 同文件 10 并发冷请求仅 1 次 render/upload                   |
| 安全         | MIME、大小、登录态和私有文件 ACL 行为与改动前一致           |
| 数据         | 无 migration、无新队列、无新增数据库列                      |

## 七、回滚方式

1. 上传内存问题：设置 `MINIO_UPLOAD_MODE=buffer`，立即回到现有兼容实现；无需回滚数据库。
2. multipart 依赖异常：回滚 `minio.service.ts` 和 API 包依赖，保留环境变量解析的默认 `auto` 行为。
3. 缩略图持久化异常：回滚 controller/service/thumbnail 工具；已生成的 `thumbnails/<fileId>/...`
   对象是惰性缓存，可直接保留或按前缀清理。
4. 304/ETag 异常：回滚条件请求分支，原有 `Cache-Control` 和 ETag 可恢复；不会影响数据库。
5. `downloadToFile()` 异常：回滚该方法及调用方，恢复使用
   `download()`；会重新带来内存成本，但不改变接口。

## 八、风险与注意事项

1. `@aws-sdk/lib-storage` 的 `Upload` 必须显式 abort，否则失败上传可能留下未完成 multipart。
2. Bun 的 Buffer fallback 是兼容路径，不要在文档或 PR 中宣称它也完成了低内存改造。
3. `ContentLength` 可能缺失；缺失时仍应校验落盘成功和必要的非空/上限条件，不能伪造长度。
4. 临时文件必须位于目标目录同一文件系统内，才能保证 `rename` 原子性。
5. 缩略图 ETag 必须使用强 ETag；版本变化后旧客户端缓存自然失效。
6. 不要在 304 之前执行 `probeObjectExists()`、原图下载或 Sharp；否则优化无效。
7. single-flight 只能解决单进程并发，不承诺多实例只生成一次。
8. 缩略图写回失败应降级为直接返回，不应把原本可显示的文件变成 500。
9. 不要改 `tasks.module.ts` 或新增 cleanup 任务；缩略图生命周期清理另立任务。
10. 本批新增 `.env.example` 内容只加独立小节，避免与 C 的进程变量冲突。
11. 大文件验收必须使用真实对象和 Node 生产路径；单元测试只能证明控制流，不能证明 RSS。

## 九、PR 合并检查清单

- [ ] 只修改 B 所有权内的文件。
- [ ] `uploadStream()` 旧签名未变，调用方无感。
- [ ] Node multipart、Bun Buffer、强制回退三种模式都有测试或明确说明。
- [ ] `downloadToFile()` 的 abort/失败/长度不符均无残留临时文件。
- [ ] 缩略图对象键、ETag、缓存头和版本号完全符合 D0 契约。
- [ ] 304 路径在读取原图和 Sharp 之前返回。
- [ ] 单进程 single-flight 和访问控制测试通过。
- [ ] 250 MB 实测数据已写入 PR。
- [ ] 没有 migration、队列任务、数据库列或大文件提交。
- [ ] 提交信息使用中文。
