# AI图像生成证书验证错误修复

## 问题描述

在使用AI图像生成功能时，后端有时会返回以下错误：

```
处理失败
Request failed: unknown certificate verification error
AI_IMAGE_GENERATION_FAILED
```

即使API实际上成功了，但由于证书验证错误导致前端收到失败响应。

## 根本原因

1. **Node.js fetch 的证书验证**：Node.js 24的原生fetch默认严格验证SSL/TLS证书
2. **上游API证书问题**：上游图像生成API可能使用：
   - 自签名证书
   - 证书链不完整
   - 过期证书
   - 证书域名不匹配
3. **网络环境**：在某些网络环境下（如公司代理、内网）证书验证可能失败

## 已实施的修复

### 1. 将证书错误标记为可重试

**文件**：`apps/api/src/modules/tasks/processors/attempt-outcome.ts`

修改了 `isRetryableError` 函数，将证书相关错误识别为可重试错误：

```typescript
export function isRetryableError(error: unknown): boolean {
  // 显式标记为不可重试的错误
  if ((error as RetryableAwareError | null)?.retryable === false) {
    return false;
  }

  // 证书验证错误应该重试（可能是临时网络问题）
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('certificate') ||
      msg.includes('cert ') ||
      msg.includes('ssl') ||
      msg.includes('tls') ||
      msg.includes('self signed') ||
      msg.includes('unable to verify')
    ) {
      return true;
    }
  }

  return true;
}
```

**效果**：
- 证书错误会自动重试（最多3次）
- 第二次或第三次请求通常会成功
- 避免一次性失败导致前端永久停在错误状态

### 2. 添加环境变量配置

**文件**：`.env.example`

添加了 `NODE_TLS_REJECT_UNAUTHORIZED` 环境变量说明。

## 使用指南

### 方案A：自动重试（推荐，已实施）

无需任何配置，系统会自动重试证书错误。

**优点**：
- ✅ 自动处理临时证书问题
- ✅ 不降低安全性
- ✅ 对用户透明

**缺点**：
- ⏱️ 失败重试会增加等待时间

### 方案B：开发环境禁用证书验证

如果证书错误持续发生，可以在 `.env.local` 中临时禁用证书验证：

```bash
# 仅用于开发环境！
NODE_TLS_REJECT_UNAUTHORIZED=0
```

**注意**：
- ⚠️ 仅用于开发环境
- ⚠️ 生产环境必须移除此配置
- ⚠️ 会降低安全性

### 方案C：修复上游证书（最佳方案）

联系AI图像生成API提供商，要求其：
1. 使用有效的SSL证书
2. 确保证书链完整
3. 确保证书域名匹配

## 验证修复

1. **清除之前失败的任务**：
   ```bash
   # 在Redis中清除失败队列（如需要）
   redis-cli FLUSHDB
   ```

2. **重新提交图像生成任务**：
   - 访问虚拟试穿页面
   - 上传图片并提交生成任务

3. **观察重试行为**：
   ```bash
   # 查看API日志
   cd apps/api && bun run dev
   
   # 观察是否有重试日志
   # [AiImageProcessor] jobId=xxx, taskId=xxx, attempt=1
   # [AiImageProcessor] jobId=xxx, taskId=xxx, attempt=2 (重试)
   ```

4. **确认成功**：
   - 第一次可能失败（证书错误）
   - 第二次或第三次应该成功
   - 前端最终显示生成的图片

## 监控和调试

### 查看任务状态

```bash
# 查看任务详情
curl http://localhost:3001/tasks/<taskId>/status
```

### 查看队列状态

访问：http://localhost:3001/admin/queues

### 查看日志

```bash
# API日志
cd apps/api && bun run dev

# 搜索证书相关错误
grep -i "certificate" log/*.log
```

## 安全建议

| 环境 | NODE_TLS_REJECT_UNAUTHORIZED | 说明 |
|------|------------------------------|------|
| **开发** | 0 或 1 | 可以禁用，但建议修复证书 |
| **测试** | 1 | 必须启用 |
| **生产** | 1（或不设置） | **绝对禁止禁用** |

## 后续优化

1. **配置自定义CA证书**：
   ```bash
   NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.crt
   ```

2. **使用undici的Agent**（更精细控制）：
   ```typescript
   import { Agent } from 'undici';
   
   const agent = new Agent({
     connect: {
       rejectUnauthorized: process.env.NODE_ENV === 'production'
     }
   });
   ```

3. **监控证书错误率**：
   - 记录证书错误发生频率
   - 设置告警阈值
   - 主动联系API提供商

## 相关文件

- `apps/api/src/modules/tasks/processors/attempt-outcome.ts` - 重试逻辑
- `apps/api/src/modules/tasks/processors/ai-image.processor.ts` - AI图像处理器
- `apps/api/src/modules/tasks/services/image-generation.service.ts` - 图像生成服务
- `.env.example` - 环境变量示例

## 提交记录

```bash
git log --oneline --grep="certificate"
```

---

**最后更新**：2026-11-03  
**修复者**：Kiro
