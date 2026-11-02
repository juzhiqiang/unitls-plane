# AI 试衣姿势图库 - 内容管理说明

## 设计原则

采用**数据库软删除 + MinIO保留**的策略：
- 数据库：删除不适合的姿势记录（前端不可见）
- MinIO：保留所有图片文件（便于将来管理）

## 当前状态

### 数据库（PostgreSQL）
```
总记录：38条（适合电商展示）
已删除：23条（3个默认种子 + 20个成人内容）
```

### 对象存储（MinIO）
```
总文件：116个（58个原图 + 58个缩略图）
保留策略：所有文件继续存储
位置：try-on-references/pose/
```

### 前端表现
```
可见姿势：38个
不可见姿势：23个（数据库无记录，API不返回）
```

## 工作原理

### 1. API层
```typescript
// apps/api/src/modules/tasks/services/ai-try-on-references.service.ts
async list(kind, lang) {
  return db.select()
    .from(aiTryOnReferences)
    .where(
      and(
        eq(aiTryOnReferences.kind, kind),
        eq(aiTryOnReferences.isEnabled, true),
        isNotNull(aiTryOnReferences.licenseReviewedAt)  // 许可审查
      )
    );
}
```

**关键点**：只返回数据库中存在的记录，已删除的姿势不会被API返回。

### 2. 前端层
```typescript
// apps/web/src/app/[locale]/(app)/image/try-on/page.tsx
const poseLibraryQuery = useAiTryOnReferences('pose');
// 只能获取到38个姿势
```

### 3. MinIO存储
```bash
# 所有文件都在
$ docker exec utils-minio mc ls local/try-on-references/pose/
[2026-11-02] 512KiB full_sexy_P001_front.png  # ✅ 在数据库中，前端可见
[2026-11-02] 421KiB upper80v2_P052_front.png  # ❌ 已从数据库删除，前端不可见
...
```

**关键点**：即使文件在MinIO中，如果数据库没有记录，前端也无法访问。

## 安全性

### ✅ 前端无法访问已删除内容
1. API不返回已删除记录 → 前端获取不到ID
2. 没有ID就无法构造缩略图URL
3. 即使猜测URL，图片也不会在界面展示

### ✅ 数据保留便于管理
1. 如需恢复某个姿势：重新INSERT数据库记录即可
2. 如需完全删除：可以单独清理MinIO文件
3. 方便审计和内容管理

## 已删除的姿势（数据库层面）

### 默认种子（3个）
- pose-a-standing
- pose-t-standing
- pose-walking

### 成人内容（20个）
详见 `AI_TRYON_CLEANUP_REPORT.md`

## MinIO文件管理

### 查看所有姿势文件
```bash
docker exec utils-minio mc ls local/try-on-references/pose/
docker exec utils-minio mc ls local/try-on-references/pose/thumbnails/
```

### 如需完全删除某个文件
```bash
# 原图
docker exec utils-minio mc rm local/try-on-references/pose/filename.png

# 缩略图
docker exec utils-minio mc rm local/try-on-references/pose/thumbnails/filename.jpg
```

### 如需恢复某个姿势
```sql
-- 1. 查找原始数据（如果有备份）
-- 2. 重新INSERT到数据库
INSERT INTO ai_try_on_references (
  slug, kind, title_zh, title_en, description_zh, description_en,
  tags, asset_bucket, asset_storage_key, thumbnail_bucket, thumbnail_storage_key,
  source_url, license_name, license_url, attribution, license_reviewed_at,
  is_enabled, sort_order
) VALUES (...);

-- 3. 前端立即可见（文件已在MinIO中）
```

## 最佳实践

### ✅ 推荐做法
- 新增姿势前人工审核内容
- 在数据库层面管理可见性（`is_enabled`字段）
- 保留MinIO文件作为资源池
- 定期审查和更新内容分类

### ❌ 不推荐做法
- 不要直接删除MinIO文件（除非确定永远不需要）
- 不要在生产环境频繁切换`is_enabled`状态
- 不要依赖URL猜测来隐藏内容（数据库层是真正的访问控制）

## 监控和审计

### 查看当前可用姿势
```bash
curl "http://localhost:3001/tasks/ai-try-on/references?kind=pose" | jq length
# 应返回: 38
```

### 查看数据库记录
```sql
SELECT COUNT(*) FROM ai_try_on_references WHERE kind = 'pose';
-- 应返回: 38

SELECT COUNT(*) FROM ai_try_on_references WHERE kind = 'pose' AND is_enabled = false;
-- 应返回: 0（我们用DELETE而非软删除）
```

### 查看MinIO文件
```bash
docker exec utils-minio mc ls local/try-on-references/pose/ | wc -l
# 应返回: 58（原图）

docker exec utils-minio mc ls local/try-on-references/pose/thumbnails/ | wc -l
# 应返回: 58（缩略图）
```

## 与前端的交互

### 1. 图库加载
```
用户点击"选择模特图库"
    ↓
前端调用: GET /tasks/ai-try-on/references?kind=pose
    ↓
API返回: 38个姿势（包含thumbnailUrl）
    ↓
前端渲染: 显示38个姿势卡片
```

### 2. 缩略图URL构造
```typescript
// API返回的格式
{
  "id": "uuid",
  "thumbnailUrl": "http://localhost:9000/try-on-references/pose/thumbnails/xxx.jpg"
}
```

**关键点**：API构造URL时只使用数据库中存在的记录。

### 3. 已删除姿势的访问尝试
```
即使有人知道某个已删除姿势的MinIO URL
    ↓
也无法通过前端界面选择该姿势
    ↓
因为数据库中没有对应的ID
    ↓
无法提交试衣任务
```

## 总结

| 维度 | 状态 | 说明 |
|------|------|------|
| 数据库记录 | 38条 | 只保留适合电商的姿势 |
| MinIO文件 | 116个 | 保留所有图片（包括已删除记录的文件） |
| 前端可见 | 38个 | 由数据库记录控制 |
| 安全性 | ✅ | 前端无法访问已删除内容 |
| 灵活性 | ✅ | 可随时恢复或完全删除 |

**这是一个合理的内容管理策略！** ✅
