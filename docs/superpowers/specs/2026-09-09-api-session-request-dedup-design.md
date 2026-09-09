# 业务 API 会话请求去重设计

## 背景

Web 端的 OpenAPI 客户端在每次业务请求前调用 `authClient.getSession()`，取得 session token 后写入 `Authorization: Bearer`。与此同时，请求已通过 `credentials: 'include'` 携带 Better Auth 的 HttpOnly 会话 Cookie，API 的全局 `AuthGuard` 也会验证该 Cookie。

任务状态和账号摘要存在 3～30 秒轮询，因此当前链路会把每次业务轮询放大成一次 `get-session` 请求加一次业务请求。Bearer 中携带的仍是数据库 session token，并不是 JWT；它没有为浏览器调用提供额外认证能力。

## 目标与非目标

目标：

- 每个业务 API 调用只产生业务请求，不再前置调用 `get-session`。
- 浏览器继续通过 HttpOnly Cookie 认证。
- 保持注销、会话撤销和账号删除后立即失效的现有语义。
- 通过自动化测试防止重新引入前置 session 请求。

非目标：

- 不迁移到 JWT。
- 不改变任务或账号摘要的轮询频率。
- 不修改 Better Auth 会话期限、Cookie Cache 或 API `AuthGuard`。
- 不改变公开接口及任务状态接口的访问边界。

## 方案选择

采用 Cookie-only：删除业务 API 客户端的 session 查询中间件和 Bearer Header 注入，仅保留 `credentials: 'include'`。

未采用客户端缓存 token，因为它需要处理失效、注销同步、跨标签页和并发刷新；未采用只对轮询接口绕过 session 查询，因为这会保留其他业务请求的冗余并造成不一致。

## 架构与数据流

修改后链路为：

1. React Query 或业务代码调用 OpenAPI 客户端。
2. 客户端使用 `credentials: 'include'` 发送业务请求，浏览器自动附带匹配域和路径的 Cookie。
3. NestJS `AuthGuard` 从请求头构造 `Headers`，调用 `verifySession()`。
4. Better Auth 强制绕过 Cookie Cache 并验证数据库会话。
5. Guard 将用户和会话挂到请求对象，控制器继续沿用现有逻辑。

`useSession()` 仍用于界面登录态、路由门控和用户信息展示；登录、注册、退出等 Better Auth 客户端功能不变。

## 错误处理与安全

Cookie 缺失、过期或已撤销时，受保护业务接口仍由现有 Guard 返回 401。前端不缓存或持有额外 token，因此不会增加过期状态同步逻辑。

生产环境仍必须使用 HTTPS，并正确配置 CORS、trusted origins、Cookie 的 Secure 与 SameSite。此次优化不改变项目当前公网部署风险，也不以 JWT 替代传输层安全。

## 修改范围

- `apps/web/src/lib/api-client.ts`：移除 `authClient` 导入及请求中间件。
- 新增 API 客户端单元测试：验证请求携带 `credentials: 'include'`，不访问 `get-session`，也不注入 `Authorization`。

不修改 API、数据库、OpenAPI schema、消息文案或项目规格文档，因为外部接口和产品行为不变。

## 验证

1. 运行新增的 API 客户端定向测试。
2. 运行 Web 全量测试。
3. 运行 Web lint。
4. 运行 Web build，覆盖 TypeScript 检查和生产构建。

验收标准：业务请求只有目标 URL 的 fetch 调用，没有 `/api/auth/get-session` 调用；受保护接口继续通过 Cookie 正常认证；现有测试、lint 和构建通过。
