# C：API 与 Worker 拆分

> 返回
> [三人并行总控](./README.md)。本批负责 API 运行时、任务 Worker 进程、Swagger 开关和公开接口认证快路径。分支：`codex/perf-api-worker`，预估 4–6 天。

> 执行进度、同条件性能对照、五队列、长任务与回滚验收见
> [执行记录](./03-api-worker-validation.md)。结果仅覆盖本地隔离环境，分支尚未合并或推送。

## 一、目标与边界

| 目标                  | 当前事实                                               | 本批结果                                           |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| 隔离 API 与任务处理   | API 与 5 类 Processor、CleanupScheduler 同进程         | `PROCESS_ROLE=api/worker/all` 可分别启动           |
| 避免任务抢占 API 资源 | 同一进程理论峰值约 15 个任务并发                       | Worker 独立扩缩容，API 只处理 HTTP                 |
| 收紧生产启动面        | Swagger 在 production 也无条件初始化                   | 生产默认关闭 `/docs`，开发默认开启                 |
| 减少公开接口认证成本  | 所有非 `@SkipSession()` 请求都会调用 `verifySession()` | 完全没有会话凭据时不查会话                         |
| 安全部署              | Compose/离线启动都只有一个 API 进程                    | API 先完成 migration/seed/readiness，再启动 Worker |

**不在本批范围**

- 不改任务业务逻辑、队列名称、重试策略和 `*_WORKER_CONCURRENCY` 默认值。
- 不改 `apps/api/src/modules/files/**`。MinIO、缩略图和上传下载归 B。
- 不修改 `packages/auth` 的 `disableCookieCache: true` 和 cookie cache 策略。
- 不新增数据库列、migration、索引或队列任务。
- 不重写所有 PDF/图片 Processor 以使用落盘接口。B 合并后只做确有收益、后续处理支持文件路径的调用点。
- 不把 Worker 暴露成 HTTP 服务，不在 Worker 中挂载 Swagger、BullBoard 或业务 Controller。

## 二、代码入口与 D0 基线

| 文件                                                                                          | 现状                                                        | 本批动作                                             |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `apps/api/src/main.ts`                                                                        | HTTP 配置和 Swagger 初始化写死在同一入口                    | 按角色选择 HTTP 或 Worker 上下文；Swagger 条件初始化 |
| `apps/api/src/app.module.ts`                                                                  | 单一根模块同时注册 HTTP 与任务处理器                        | 拆成 API、Worker 和兼容旧行为的 all 组合             |
| `apps/api/src/modules/tasks/tasks.module.ts`                                                  | Controller、服务、5 个 Processor、CleanupScheduler 混在一起 | 拆成 Core / API / Worker 三个模块                    |
| `apps/api/src/common/guards/auth.guard.ts`                                                    | 普通 `@Public()` 也先调用 `verifySession()`                 | 增加无凭据快速路径，保留原有完整校验                 |
| `apps/api/src/modules/health/health.controller.ts`                                            | 已有 `/health/live`、`/health/ready`                        | 作为 API 就绪探针；Worker 不使用 HTTP 探针           |
| `apps/api/src/scripts/export-openapi.ts`                                                      | 自行创建 `AppModule` 导出文档                               | 改用 API-only 根模块，避免拉起 Worker                |
| `docker-compose.prod.yml`                                                                     | API 同时执行迁移、seed 和 all 进程                          | API 显式 `PROCESS_ROLE=api`，新增无端口 Worker 服务  |
| `docker/start-all.sh`                                                                         | 只管理 API、Web 两个子进程                                  | 管理 API、Worker、Web，并在 API ready 后启动 Worker  |
| `.env.example`                                                                                | 只有 Worker 并发变量                                        | 增加进程角色和 Swagger 开关的独立小节                |
| `apps/api/test/config/**`、`apps/api/test/common/guards/**`、`apps/api/test/modules/tasks/**` | 已有部分测试                                                | 增加角色、Swagger、认证快路径和模块组合测试          |

### D0 基线记录

在改动前采集并写入 PR，不能只凭体感判断：

1. 任务低负载、高负载两种场景下，API 的 P50/P95 延迟、RSS 和事件循环延迟。
2. 同一台机器同时跑 2 个 Image、2 个 PDF、2 个 Font、8 个 AI 任务时，API 的 P95 变化。
3. Worker 各队列的吞吐、失败率、排队时长和实际并发。
4. API 冷启动耗时，以及 migration、模型同步、preset seed 各阶段耗时。
5. `/docs` 初始化耗时、内存占用和 OpenAPI 文档生成耗时。
6. 公开接口分别携带与不携带会话 cookie 时的 P95 和数据库查询次数。
7. 当前 PostgreSQL `max_connections`、应用连接池上限和 Redis 连接数。

> D0 只记录事实，不提前修改并发、连接池或重试参数。优化收益必须在同一构建机、同一压测脚本下比较。

## 三、D0 接口与进程契约

### 3.1 进程角色

```ts
type ProcessRole = 'all' | 'api' | 'worker';
// 环境变量：PROCESS_ROLE，默认 all
```

| 角色     | HTTP | Processor | CleanupScheduler | Swagger | BullBoard | migration/seed      |
| -------- | ---- | --------- | ---------------- | ------- | --------- | ------------------- |
| `all`    | 是   | 是        | 是               | 按开关  | 是        | 由启动脚本执行      |
| `api`    | 是   | 否        | 否               | 按开关  | 是        | 由 API 启动命令执行 |
| `worker` | 否   | 是        | 是               | 否      | 否        | 否                  |

约束：

- `all` 必须保持当前行为，旧部署不配置 `PROCESS_ROLE` 也能启动并消费任务。
- 非法角色必须在启动阶段报错退出，不能静默回退到 `all`。
- Worker 使用 `NestFactory.createApplicationContext()`，不创建 HTTP adapter、不调用 `listen()`。
- `CleanupScheduler` 只注册在 Worker 组合中。现有 repeatable job 的固定 `jobId` 不能删除。
- `NestFactory` 创建的 app 必须调用 `enableShutdownHooks()`；不要自己再实现一套 BullMQ 关闭逻辑。
- `@nestjs/bullmq` 的 BullExplorer 关闭时会调用 Worker 的 `close()`
  并等待在途任务。容器宽限期要覆盖最长任务。

### 3.2 Swagger 开关

```ts
// SWAGGER_ENABLED=true|false
// 默认：production=false，其他环境=true
```

- 只接受 `true`、`false` 两个显式值，大小写可采用现有环境变量解析习惯统一处理；非法值启动失败。
- `openapi:export` 不依赖该运行时开关，仍必须稳定生成 `openapi.json`。
- 生产镜像未显式设置时，`/docs` 应返回 404；需要临时排查时可显式设为 `true`。

### 3.3 会话凭据判定

只有同时满足以下条件才走快速路径：

1. 没有 `Authorization` 头。
2. 没有 Better-Auth 会话 cookie。

至少要识别以下 cookie，包括 `.<数字>` 分片形式：

- `better-auth.session_token`
- `better-auth.session_data`
- `__Secure-better-auth.session_token`
- `__Secure-better-auth.session_data`

伪代码：

```ts
if (skipSession) return true;

if (!hasSessionCredentials(request)) {
  if (isPublic) return true;
  throw new UnauthorizedException('Not authenticated');
}

// 保留现有 verifySession、续期 cookie、request.user/session 赋值逻辑
```

不要把任意 cookie 当成会话凭据。`@Public()` 且读取可选用户的接口，只要带会话凭据就必须继续完整校验。

## 四、实施步骤

### C1. 拆分 Tasks 模块与进程入口

1. 新建纯函数 `parseProcessRole(value: string | undefined): ProcessRole`，默认
   `all`，非法值抛出明确错误；补单元测试。
2. 将任务模块拆为：
   - Tasks Core：队列注册、共享服务、数据库状态和导出；
   - Tasks API：`TasksController`、`FontsController`；
   - Tasks Worker：5 个 Processor 和 `CleanupScheduler`。
3. 建立 API-only 根模块：
   - 只包含 Auth、Files、Health、Account、Tasks
     API、BullBoard、全局 Guard、Throttler 和 HTTP 中间件。
   - 保留 `BasicAuthMiddleware` 只作用于 `/admin/queues`。
4. 建立 Worker 根模块：
   - 只导入任务 Core、Files 和 Worker 组合。
   - 不导入 Swagger、CORS、全局 HTTP Filter、全局 Guard、Throttler、BullBoard、HealthController。
5. 保留 `AppModule` 作为 `all` 兼容组合，导入 API 根模块和 Worker 根模块；默认行为不能变化。
6. 修改 `main.ts`：
   - `all`/`api`：创建 HTTP app，执行现有压缩、CORS、过滤器、ValidationPipe 和监听；
   - `worker`：只创建应用上下文并等待关闭信号；
   - 只有 HTTP 角色且 `SWAGGER_ENABLED=true` 时创建 `/docs`。
7. Worker 可以加载现有
   `FilesModule`。其中上传临时目录初始化即使执行也可以接受，**不要在 C 批重构 FilesModule**。
8. 避免模块循环依赖。共享服务放 Core；Controller 只进 API；Processor 只进 Worker。不要用
   `forwardRef()` 掩盖设计问题。

**验收**：`PROCESS_ROLE=api` 能提供全部 HTTP 路由但不消费任务；`PROCESS_ROLE=worker`
不监听端口且能消费任务；`PROCESS_ROLE=all` 与改动前行为一致。

### C2. Swagger 开关与 OpenAPI 导出

1. 新建 `parseSwaggerEnabled(value, nodeEnv)` 纯函数并测试：
   - 生产未设置 → `false`；
   - 开发未设置 → `true`；
   - 显式 `true`/`false` 覆盖默认；
   - 非法值抛错。
2. 抽出 `DocumentBuilder` 配置，避免 `main.ts` 与导出脚本漂移。
3. `main.ts` 只在 `SWAGGER_ENABLED=true` 时调用 `SwaggerModule.createDocument()` 和 `setup()`。
4. `export-openapi.ts`
   改用 API-only 根模块，并显式创建文档；不得因为生产默认关闭 Swagger 而停止导出。
5. 保持 `/docs` 路径不变；本批不改变 OpenAPI 内容和 API 响应结构。

**验收**：production 默认 `/docs` 404；显式开启后 200；开发环境默认 200；`openapi:export`
成功且没有启动 Worker。

### C3. 认证快路径

1. 新增可单测的 `hasSessionCredentials(headers)` 或等价纯函数。
2. 解析 `cookie` 头时按 cookie 名称精确匹配，支持 `.0`、`.1` 等 Better-Auth 分片后缀；不要用宽松的
   `includes('session')`。
3. `Authorization` 存在时一律走完整
   `verifySession()`，因为 Bearer 校验、续期和用户注入仍由现有实现负责。
4. 无凭据分支：
   - `@Public()` 直接放行；
   - 受保护路由直接抛 401；
   - 两者都不调用 `verifySession()`，也不构造无意义的 `Headers`。
5. 有凭据时保留：
   - `verifySession()` 调用；
   - `set-cookie` 续期转发；
   - `request.user`、`request.session` 赋值；
   - 私有文件、缩略图和下载的访问控制。
6. 保留 `@SkipSession()` 的最高优先级。健康检查仍完全跳过会话层。
7. 不改 `packages/auth` 的 `disableCookieCache: true`。本轮先消除无凭据请求，再评估 cookie
   cache 策略。

**验收**：公开接口无凭据时 `verifySession()`
调用 0 次；受保护接口无凭据时 0 次且返回 401；任意会话 cookie、分片 cookie、Authorization 仍按原逻辑校验并可续期。

### C4. Compose 与离线单容器

1. `docker-compose.prod.yml` 的 API 服务设置 `PROCESS_ROLE=api`，并保留 migration、模型同步、preset
   seed。
2. API 命令最后一步必须使用 `exec node apps/api/dist/main.js`，保证 SIGTERM 直达 Node。
3. 为 API 增加 `/health/ready` healthcheck。镜像内用 Node 内置 `fetch`，不依赖
   `curl`；`start_period` 按 D0 启动耗时设置并留出余量。
4. 新增同镜像 Worker 服务：
   - 设置 `PROCESS_ROLE=worker`；
   - 不映射端口；
   - `depends_on` API 的 `condition: service_healthy`；
   - 同时依赖 PostgreSQL、Redis、MinIO 健康；
   - 不执行 migration、模型同步或 preset seed。
5. Web 改为依赖 API 的 `service_healthy`，不要只依赖 `service_started`。
6. API、Worker 和单容器启动设置
   `stop_grace_period`。起始值不低于 60 秒，最终值不得短于实际最长任务时长。
7. Worker 不配置 HTTP healthcheck，也不伪造
   `/health`。进程退出交给容器重启策略，队列积压和心跳交给 BullMQ 指标/告警。
8. `docker/start-all.sh`：
   - migration、模型同步、preset seed 只执行一次；
   - 以 `PROCESS_ROLE=api` 启动 API；
   - 轮询 `/health/ready`，通过后再以 `PROCESS_ROLE=worker` 启动 Worker；
   - 同时启动 Web，并让 trap 在 INT/TERM 时关闭三个子进程；
   - 任意核心子进程退出时，终止其余进程并以非零状态退出。
9. Compose 环境变量建议用 YAML 公共锚点复用，防止 API 与 Worker 的数据库、Redis、MinIO、认证和 AI 配置漂移；角色变量和 Worker 并发变量单独覆盖。
10. 更新 `PROJECT_SPECS.md` 和离线部署文档，写清 `all`、Compose 双进程、单容器三进程三种模式。

**验收**：API 先完成 migration/seed 并通过 readiness，Worker 才启动；API 退出时 Worker 不会继续消费；停止容器时在途任务不被硬中断。

### C5. 与 B 的软依赖

1. C 不等待 B 的 `downloadToFile()`，进程拆分先用现有 `download()` 完成。
2. B 合并后，只检查 C 拥有且后续处理确实支持文件路径的 Worker 调用点；不要把 Buffer 型 PDF/图片处理链整体重写成临时文件链。
3. 如果某个 Processor 仍需要
   `Buffer`，继续使用现有接口并在文档中记录后续改造，不要为了“用上新方法”引入额外读写或破坏任务语义。
4. `apps/api/package.json` 和 `bun.lock` 的 multipart 依赖归 B；C 不为本批新增运行时依赖。

## 五、测试清单

```powershell
bun --cwd apps/api test
bun --cwd apps/api lint
bun --cwd apps/api build
bun run format:check:changed
docker compose -f docker-compose.prod.yml config
```

新增/补充测试至少覆盖：

1. `PROCESS_ROLE` 的默认值、三个合法值和非法值。
2. `SWAGGER_ENABLED` 的生产/开发默认值、显式 true/false 和非法值。
3. 公开接口无凭据不调用 `verifySession()`，受保护接口无凭据直接 401。
4. 普通非会话 cookie 不触发会话查询。
5. 四种 Better-Auth cookie 名称及 `.0`/`.1` 分片都能触发完整校验。
6. Authorization 存在时仍调用 `verifySession()`，并保留续期 cookie 转发。
7. `@SkipSession()` 在两种环境下都直接放行。
8. API-only 模块不包含 Processor/CleanupScheduler；Worker 模块不包含 Controller/Swagger/BullBoard。
9. `openapi:export` 在 `NODE_ENV=production` 且 `SWAGGER_ENABLED=false` 时仍成功。
10. 既有认证、健康检查、任务服务和 Files 测试不回归。

手工/集成验收：

- 分别启动 `PROCESS_ROLE=api`、`worker`、`all`，检查端口、日志和队列消费。
- API 单独运行时向队列投递测试任务，任务应保持等待且不被 API 消费。
- Worker 单独运行时确认没有 HTTP 端口和 `/docs`。
- Compose 冷启动确认 Worker 在 API healthy 后才出现。
- 停止 API/Worker，确认 SIGTERM 被 Node 接收、在途任务完成或按预期重新入队。
- 单容器 `start-all.sh` 验证 API、Worker、Web 任一退出时其余进程被清理。
- 高负载任务期间记录 API P95，与 D0 同条件对比。

## 六、验收标准

| 指标        | 通过条件                                                     |
| ----------- | ------------------------------------------------------------ |
| 兼容启动    | 不设置 `PROCESS_ROLE` 时仍为 `all`，现有功能可用             |
| API 角色    | 所有 HTTP 路由可用；无 Processor、CleanupScheduler、任务消费 |
| Worker 角色 | 无 HTTP 端口、无 Swagger/BullBoard；5 类任务可正常消费       |
| Cleanup     | 定时清理在 Worker 注册且只注册一次                           |
| 部署顺序    | API migration/seed/readiness 完成后 Worker 才启动            |
| Swagger     | production 默认 404；显式开启后 200；开发默认 200            |
| OpenAPI     | `openapi:export` 成功，不受运行时开关影响                    |
| 认证        | 无凭据公开路由 0 次 `verifySession()`；有凭据行为不变        |
| 资源隔离    | 任务高负载时 API P95 较 D0 目标下降 20%，至少不得劣化        |
| 优雅退出    | SIGTERM 后不硬中断在途任务，容器宽限期足够                   |
| 数据        | 无 migration、无新表、无新队列、无任务语义变化               |

> 20% 是目标，不是伪造结果。若真实压测没有达到，必须保留数据并说明瓶颈是否已转移到数据库、Redis 或文件 IO。

## 七、回滚方式

1. 进程拆分异常：所有环境设置 `PROCESS_ROLE=all`，删除 Compose
   Worker 服务，恢复单进程启动；无需数据库回滚。
2. 离线启动异常：回滚 `docker/start-all.sh`，恢复只启动 API/Web 的版本；仍可通过 `PROCESS_ROLE=all`
   运行任务。
3. Swagger 不可用：显式设置 `SWAGGER_ENABLED=true`；无需改代码或重新 migration。
4. OpenAPI 导出异常：回滚导出脚本和 API-only 根模块，恢复使用 `AppModule` 导出。
5. 认证快路径异常：回滚 `auth.guard.ts` 和无凭据判定工具；所有请求回到原有 `verifySession()` 路径。
6. Worker 关闭/任务中断异常：先停止 Worker，再排空队列或等待任务结束；最后回滚角色拆分，不删除 Redis 中的队列数据。

## 八、风险与注意事项

1. **滚动发布期间不能双重消费**：先把 API 改为 `PROCESS_ROLE=api`
   并确认不再注册 Processor，再启动新 Worker。否则旧 API 和新 Worker 会同时消费，短时并发翻倍。
2. **数据库连接池会翻倍**：`packages/db` 当前每个进程 `max: 20`。API +
   Worker 默认最多 40 个连接；扩 Worker 副本前必须核对 PostgreSQL
   `max_connections`。本批不擅自改连接池默认值。
3. **Redis 连接和队列指标也会增加**：Compose
   Worker 不能暴露端口，但必须能连 Redis。健康检查只能依赖 API
   readiness 或外部监控，不能在 Worker 内伪造 HTTP 服务。
4. **部署顺序是硬依赖**：migration、模型同步、preset
   seed 只能由 API 启动命令或启动引导执行。Worker 不得重复执行，也不得在 API ready 前启动。
5. **`all` 是回滚保险**：任何模块拆分都不能破坏默认 `all`。合并前必须实际跑一次 `all` 的任务消费。
6. **Worker 不加载 HTTP 栈**：不要复用 `main.ts`
   中完整的 CORS、Filter、ValidationPipe、Swagger 和 Guard 初始化。Worker 应走独立 bootstrap 分支。
7. **全局 Guard 只属于 HTTP 根模块**：不要把
   `APP_GUARD`、`BasicAuthMiddleware`、Throttler 或 BullBoard 放进 Worker 模块。
8. **认证快路径只处理“完全无凭据”**：带 cookie 的可选用户接口仍要调用完整校验；任意普通 cookie 不能触发或绕过会话查询。
9. **分片 cookie 必须识别**：Better-Auth 可能使用 `.0`、`.1` 后缀，名称匹配必须精确，不能用模糊
   `includes()`。
10. **不要改会话缓存策略**：本批不碰 `disableCookieCache`。关闭或开启 cookie
    cache 是独立的安全与一致性决策。
11. **Swagger 默认值必须有测试**：生产默认关闭、开发默认开启、显式覆盖和非法值都要覆盖；导出脚本必须绕过默认关闭。
12. **`openapi:export`
    不能创建 Worker**：导出只应加载 API-only 根模块，否则 CI 会连接 Redis/数据库并注册 Processor。
13. **信号要直达 Node**：Compose API 命令末尾用 `exec`；Worker 直接 exec 为 node；`start-all.sh`
    的 trap 必须关闭三个 PID 并等待退出。
14. **不要自定义一套 Worker 关闭实现**：`enableShutdownHooks()` 加上 BullExplorer 的默认 `close()`
    已负责等待在途任务；重复实现容易造成双关闭或任务丢失。
15. **宽限期按真实任务调整**：60 秒只是起点。若 PDF/AI 任务可能更长，`stop_grace_period`
    必须按 D0 和任务超时配置提高。
16. **不要改并发默认值**：Image 2、PDF 2、Font 2、AI 8、Cleanup
    1 保持现状。拆进程后先测隔离收益，再单独调并发。
17. **不要改 B 的文件实现**：C 只读 `FilesModule`。B 合并后 switch 到 `downloadToFile()`
    必须逐点评估，不能全量替换 Buffer 处理链。
18. **不要新增 migration**：本批不新增表、列、索引或队列任务。需要持久化进程状态时另立任务。
19. **不要提交构建产物**：`openapi.json`
    若因生成发生非预期变化，先确认路由是否真的改变；不提交日志、截图、模型和本地环境文件。
20. **两套部署都要验收**：Compose 双进程与离线单容器三进程的启动、健康检查、停止和回滚都必须实际跑一遍。

## 九、PR 合并检查清单

- [x] 只修改 C 所有权内的文件，未改 `apps/api/src/modules/files/**` 和 `packages/auth` 缓存策略。
- [x] `PROCESS_ROLE=all/api/worker` 三种模式均实际启动验证。
- [x] API 不注册 Processor，Worker 不监听 HTTP，CleanupScheduler 只在 Worker。
- [x] 不设置 `PROCESS_ROLE` 时保持旧行为。
- [x] Swagger 的默认值、覆盖值和非法值测试通过。
- [x] `openapi:export` 在 production 且 Swagger 关闭时仍通过。
- [x] 公开接口无凭据 0 次 `verifySession()`，有凭据仍完整校验并续期。
- [x] Compose 使用 API readiness 门控 Worker，Worker 不暴露端口。
- [x] API/Worker/单容器信号与宽限期已验证；595 秒长请求样本在 SIGTERM 后等待约 596 秒正常退出，任意工作流仍按实测调整宽限期。
- [x] `start-all.sh` 的 migration/seed 只执行一次，三个子进程都能被清理。
- [x] 本地 1 API + 1 Worker 的数据库池、Redis 连接和 PostgreSQL `max_connections`
      已记录；目标环境按副本数重新核验。
- [ ] 高负载前后 API P95、RSS、队列吞吐数据已写入 PR（数据已写入执行记录，尚未创建 PR）。
- [x] API-only 回滚默认 `all`、API 故障后的 Worker 退出/重启已验证，无数据库回滚。
- [x] 提交信息使用中文。
