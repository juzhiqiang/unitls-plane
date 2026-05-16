# 06 - 配置 Upstash Redis

> 依赖：无（外部配置，可最先开始）
> 预估：0.5h
> 可并行：与所有任务并行

## 目标

创建 Upstash Redis 实例，用于 Bull/BullMQ 任务队列 + @nestjs/throttler 限流。

## 步骤

### 6.1 创建 Upstash Redis 实例

1. 登录 https://console.upstash.com
2. 创建 Redis Database：
   - Name: `utils-plane`
   - Region: 选择与 Supabase 相近的区域
   - Type: Regional（单区域，延迟最低）
   - Eviction: 关闭（队列数据不能被驱逐）

### 6.2 获取连接信息

从 Upstash Dashboard 获取：

```env
UPSTASH_REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379
UPSTASH_REDIS_TOKEN=xxx
```

### 6.3 验证连接

```bash
# 使用 redis-cli 或 Upstash REST API 测试
curl -X POST https://xxx.upstash.io \
  -H "Authorization: Bearer $UPSTASH_REDIS_TOKEN" \
  -d '["PING"]'
# 期望返回: "PONG"
```

### 6.4 更新 .env.local

将 Redis 凭证添加到根目录 `.env.local`：

```env
UPSTASH_REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379
UPSTASH_REDIS_TOKEN=xxx
```

### 6.5 注意事项

- **免费 tier 限制**：10K commands/天，256MB 存储
- **Bull/BullMQ 兼容性**：Upstash Redis 支持 BullMQ 所需的所有命令
- **TLS**：Upstash 默认使用 TLS（`rediss://`），BullMQ 连接时需配置 `tls: {}`
- **如果免费额度不够**：升级到 Pay-as-you-go（$0.2/100K commands）

## 验收标准

- [ ] Upstash Redis 实例已创建
- [ ] PING 测试返回 PONG
- [ ] 凭证已写入 `.env.local`
- [ ] 确认 Eviction 已关闭
