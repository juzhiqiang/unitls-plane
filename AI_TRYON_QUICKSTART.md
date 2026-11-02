# AI 试衣功能快速启动

## 前置条件
```bash
# 确保Docker服务运行
docker ps  # 应看到 utils-pg, utils-redis, utils-minio

# 确保已执行migration
cd packages/db
bunx drizzle-kit migrate
```

## 启动步骤

### 1. 启动API服务
```bash
cd apps/api
bun run dev
# 监听：http://localhost:3001
```

### 2. 启动Web服务
```bash
cd apps/web
PORT=3000 bun run dev
# 监听：http://localhost:3000
```

### 3. 访问试衣页面
```
http://localhost:3000/zh/image/try-on
```

## 验证姿势图库

### 方法1：通过API
```bash
curl "http://localhost:3001/tasks/ai-try-on/references?kind=pose" | jq '.[] | {slug, title}'
```

### 方法2：通过Web UI
1. 打开试衣页面
2. 点击"选择模特图库"按钮
3. 查看姿势列表（应显示61个姿势）

## 测试完整流程

### 注册测试账号（如未注册）
```bash
curl -X POST http://localhost:3001/api/auth/sign-up \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123456",
    "name": "Test User"
  }'
```

### 创建试衣任务
```bash
# 1. 登录获取session
# 2. 上传商品图片获取fileId
# 3. 获取姿势referenceId
# 4. 创建任务
curl -X POST http://localhost:3001/tasks \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session_token=YOUR_TOKEN" \
  -d '{
    "type": "image_try_on",
    "payload": {
      "productFileId": "商品图片UUID",
      "poseReferenceId": "姿势参考UUID"
    }
  }'
```

## 查看MinIO图片
```
http://localhost:9001
用户名：minioadmin
密码：minioadmin

查看桶：try-on-references
路径：pose/ 和 pose/thumbnails/
```

## 常见问题

### Q: CORS错误
A: 确保Web运行在3000端口，API的CORS配置默认允许localhost:3000

### Q: 图库加载失败
A: 检查数据库中license_reviewed_at字段是否已设置

### Q: 图片显示404
A: 检查MinIO中图片是否已上传：
```bash
docker exec utils-minio mc ls minio/try-on-references/pose/
```

## 重新导入姿势（如需要）
```bash
cd apps/api

# 1. 下载数据
curl -o pose-zh.json https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/data/pose-zh.json

# 2. 导入数据库
bun run src/scripts/import-pose-references.ts pose-zh.json

# 3. 下载并上传图片
bun run src/scripts/download-pose-images.ts pose-images-to-download-fixed.json

# 4. 设置许可审查时间
docker exec -e PGPASSWORD=utils utils-pg psql -U utils -d utils_plane -c \
  "UPDATE ai_try_on_references SET license_reviewed_at = NOW() WHERE slug LIKE 'pose-%' AND license_reviewed_at IS NULL;"
```

## 扩展服饰/人像图库
参考 `apps/api/src/scripts/import-pose-references.ts` 创建类似脚本，修改：
- `kind` 参数为 `garment` 或 `person`
- 数据源和筛选规则
- MinIO存储路径
