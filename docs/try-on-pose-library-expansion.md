# 试衣姿势图库扩展指南

## 当前状态

项目包含 3 个基础姿势参考（A字站姿、T字站姿、行走姿势），足以验证试衣功能。

## 扩展来源

推荐从以下开源项目获取更多姿势：

### 1. AI Pose Gallery ZH（推荐）
- **项目地址**：https://github.com/anhao/ai-pose-gallery-zh
- **许可证**：CC0 1.0（公共领域）
- **姿势数量**：1439 个（含多角度）
- **数据格式**：JSON + PNG 图片
- **适用类别**：站姿、行走、坐姿、跪姿等

### 2. Open Pose & Costume
- **在线预览**：https://hongye007.github.io/open-pose-costume/
- **GitHub**：https://github.com/hongye007/open-pose-costume
- **说明**：整合上述数据源的可视化参考库

## 扩展步骤

### 方法一：使用导入脚本（推荐）

```bash
# 1. 下载姿势数据
curl -o pose-zh.json https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/data/pose-zh.json

# 2. 运行导入脚本（从 230+ 个正面姿势中按分类平衡选择 50 个）
cd apps/api
bun run src/scripts/import-pose-references.ts ../../../pose-zh.json

# 3. 下载对应图片（从 ai-pose-gallery-zh 仓库）
# 脚本会输出需要下载的图片列表

# 4. 上传图片到 MinIO
# - 原图上传到：try-on-references/pose/
# - 缩略图上传到：try-on-references/pose/thumbnails/
```

### 方法二：手动选择姿势

1. **浏览参考库**：访问 https://hongye007.github.io/open-pose-costume/?lang=zh&view=pose
2. **筛选姿势**：选择"站姿"、"行走"等适合试衣的分类
3. **记录信息**：姿势编号、名称、图片URL
4. **下载图片**：从开源仓库下载对应的 PNG
5. **更新种子脚本**：参考 `apps/api/src/scripts/seed-ai-try-on-references.ts`

## 筛选建议

**优先选择**：
- ✅ 站姿（自然站立、展示型站姿）
- ✅ 行走（走秀步态、日常行走）
- ✅ 坐姿（椅子坐姿、地面坐姿）
- ✅ 跪姿（适合某些服装展示）

**避免选择**：
- ❌ 躺卧姿势（试衣展示效果差）
- ❌ 极端动作（舞蹈、运动、瑜伽等）
- ❌ 双人或多人姿势
- ❌ 特殊服装绑定姿势（泳装、内衣）

## 数据格式

每个姿势记录包含：

```typescript
{
  slug: string;              // 唯一标识，如 "pose-standing-p001"
  kind: 'pose';
  title_zh: string;          // 中文名称
  title_en: string;          // 英文名称
  description_zh: string;    // 中文描述
  description_en: string;    // 英文描述
  tags: string[];            // 标签：['standing', 'front', 'natural']
  asset_bucket: string;      // 'try-on-references'
  asset_storage_key: string; // 'pose/full_basic_P001_front.png'
  thumbnail_storage_key: string; // 'pose/thumbnails/...'
  source_url: string;        // 原始来源链接
  license_name: string;      // 'CC0-1.0'
  attribution: string;       // 'AI Pose Gallery ZH'
  is_enabled: boolean;
  sort_order: number;
}
```

## 注意事项

1. **版权尊重**：只使用 CC0 或明确开源许可的素材
2. **归属标注**：在数据库中正确填写 `attribution` 和 `source_url`
3. **图片尺寸**：建议统一为 1024x1024 或类似比例
4. **命名规范**：使用 `pose-{category}-{code}` 格式的 slug
5. **分类标签**：保持与现有标签体系一致

## 维护与更新

当开源库更新时：
1. 重新运行导入脚本获取最新数据
2. 检查新增姿势是否适合试衣场景
3. 更新 `apps/api/src/scripts/seed-ai-try-on-references.ts`
4. 重新生成并执行 migration

## 相关文件

- 导入脚本：`apps/api/src/scripts/import-pose-references.ts`
- 种子脚本：`apps/api/src/scripts/seed-ai-try-on-references.ts`
- 图库 Service：`apps/api/src/modules/tasks/services/ai-try-on-references.service.ts`
- 数据库 Schema：`packages/db/src/schema/ai-try-on-references.ts`


