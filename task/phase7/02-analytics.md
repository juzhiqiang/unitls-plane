# 02 - 自研 Telemetry + Web Vitals

> 依赖：Phase 3、Phase 7 / 01-sentry.md
> 预计：1h
> 可并行：可与 03-performance.md 并行
> 部署约束：不依赖 Vercel，不接入 Vercel Analytics / Speed Insights

## 目标

基于项目已有的简版 Sentry / Telemetry 服务，采集前端 Web Vitals、页面访问、关键业务事件和客户端异常，为 Phase 7 / 03-performance 提供真实性能数据。

本任务不使用 Vercel Analytics。所有数据统一上报到自研观测服务，避免部署平台绑定。

## 事件分类

| 类型 | 说明 | 示例 |
|------|------|------|
| `web_vital` | 页面性能指标 | `LCP`、`CLS`、`INP`、`FCP`、`TTFB` |
| `page_view` | 页面访问 | `/zh/image/compress` |
| `business_event` | 产品关键行为 | `tool_used`、`file_processed`、`signed_up` |
| `client_error` | 浏览器端异常 | `window.onerror`、`unhandledrejection` |

## 步骤

### 2.1 安装 Web Vitals 采集依赖

```bash
cd apps/web
bun add web-vitals
```

> 如使用 Next.js 内置 `useReportWebVitals` 能满足需求，也可以不安装 `web-vitals`。但推荐使用 `web-vitals` 包，便于在普通 client component、错误边界和自定义采样逻辑中复用。

### 2.2 增加前端 Telemetry Client

新增 `apps/web/src/lib/telemetry.ts`，统一封装上报逻辑。

建议暴露：

```typescript
export const telemetry = {
  pageView: (path: string) => {},
  webVital: (metric: WebVitalPayload) => {},
  clientError: (error: ClientErrorPayload) => {},
  track: (name: BusinessEventName, properties?: Record<string, unknown>) => {},
};
```

上报要求：

- 使用 `navigator.sendBeacon()` 优先发送，失败时 fallback 到 `fetch(..., { keepalive: true })`
- 仅在浏览器端执行
- 支持 `NEXT_PUBLIC_TELEMETRY_ENABLED=false` 关闭
- 支持采样率配置，例如 `NEXT_PUBLIC_TELEMETRY_SAMPLE_RATE=0.1`
- 不阻塞用户主流程

### 2.3 采集 Web Vitals

新增 `apps/web/src/components/telemetry/web-vitals-reporter.tsx`。

采集指标：

- `LCP`：目标 < 2.5s
- `CLS`：目标 < 0.1
- `INP`：目标 < 200ms
- `FCP`：用于辅助定位首屏问题
- `TTFB`：目标 < 800ms

指标字段建议：

```typescript
type WebVitalPayload = {
  name: 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  id: string;
  path: string;
};
```

将 reporter 挂载到 `apps/web/src/app/[locale]/layout.tsx`，确保所有页面都能采集。

### 2.4 采集页面访问

新增 `apps/web/src/components/telemetry/page-view-reporter.tsx`。

要求：

- 监听 App Router 路由变化
- 上报 `page_view`
- 记录 `path`、`locale`、`referrer`、`userAgent` 的安全摘要
- 不记录 query 中的敏感字段，例如 token、code、email

### 2.5 采集关键业务事件

新增或更新 `apps/web/src/lib/analytics.ts`，作为业务侧调用入口。

```typescript
export const analytics = {
  toolUsed: (tool: 'image' | 'pdf' | 'font', action: string) => {
    telemetry.track('tool_used', { tool, action });
  },
  fileProcessed: (
    type: string,
    size: number,
    location: 'client' | 'server'
  ) => {
    telemetry.track('file_processed', { type, size, location });
  },
  signedUp: (method: 'email' | 'google' | 'github') => {
    telemetry.track('signed_up', { method });
  },
};
```

关键调用点：

- 工具打开或开始处理：`analytics.toolUsed('image', 'compress')`
- 文件处理完成：`analytics.fileProcessed(...)`
- 注册成功：`analytics.signedUp(...)`

### 2.6 采集客户端异常

新增 `apps/web/src/components/telemetry/client-error-reporter.tsx`。

采集来源：

- `window.addEventListener('error', ...)`
- `window.addEventListener('unhandledrejection', ...)`
- React Error Boundary 可在后续任务补充

脱敏要求：

- 不上传文件内容
- 不上传原始 token、cookie、authorization header
- 不上传完整邮箱、手机号
- 文件名如有必要，只上传扩展名和大小

### 2.7 后端接收接口

在简版 Sentry / Telemetry 后端增加统一接收接口：

```http
POST /telemetry/events
```

Payload 建议：

```typescript
type TelemetryEvent = {
  type: 'web_vital' | 'page_view' | 'business_event' | 'client_error';
  name: string;
  path?: string;
  value?: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
  properties?: Record<string, unknown>;
  sessionId?: string;
  userId?: string;
  timestamp: string;
};
```

后端要求：

- 使用 DTO / class-validator 校验 payload
- 限制 `properties` 大小
- 对 IP、User-Agent 做必要截断或 hash
- 支持匿名用户事件
- 接口失败不能影响前端功能

### 2.8 存储与查询

简版优先存 PostgreSQL。

建议表：

- `telemetry_events`
- `telemetry_web_vitals`（可选，如需高频查询再拆表）

最小字段：

- `id`
- `type`
- `name`
- `path`
- `value`
- `rating`
- `userId`
- `sessionId`
- `properties`
- `createdAt`

如果事件量增长，再在后续任务迁移到 ClickHouse / TimescaleDB / 日志系统。

### 2.9 性能问题流转

当 Web Vitals 不达标时，记录到 Phase 7 / 03-performance 跟进：

- 页面路径
- 指标名称
- 当前值
- 目标值
- 可能原因
- 优先级

## 验收标准

- [ ] 不再依赖 Vercel Analytics / Vercel Dashboard / Speed Insights
- [ ] Web Vitals 可上报：`LCP`、`CLS`、`INP`、`FCP`、`TTFB`
- [ ] 页面访问事件 `page_view` 可上报
- [ ] 业务事件可上报：`tool_used`、`file_processed`、`signed_up`
- [ ] 客户端异常 `client_error` 可上报
- [ ] 后端对 telemetry payload 做校验、大小限制和脱敏
- [ ] 数据进入自研简版 Sentry / Telemetry 存储
- [ ] 上报失败不影响页面功能
- [ ] 无 console 错误

## 非目标

- 不接入 Vercel Analytics
- 不接入 PostHog / Umami / Google Analytics
- 不实现完整数据分析 Dashboard
- 不采集文件内容、原始 token、cookie、authorization header
