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
- **自建人物参考**：仓库 `data/custom/character.json` 共 28 条，属于自建素材，
  默认条款禁止商用与再分发；本项目已取得维护者单独授权后导入。
  - 多地区人物参考 22 条（RCF-001 ~ RCF-022）：11 个地区 × 男女
    （法/加/美/日/德/巴西/印度/俄/澳/韩/英），带性别与地区标签；
  - 男性风格参考 6 条（MCF-001 ~ MCF-006）：只有性别，没有地区。
  - 导入脚本：`cd apps/api && bun --env-file=../../.env.local run src/scripts/import-character-custom.ts`
  - MinIO：原图 `try-on-references/person/custom/custom_character_*.png`，缩略图
    `try-on-references/person/custom/thumbnails/custom_character_*.webp`
  - 数据库：slug 用上游变体 id（如 `custom_character_region_fr_female`），
    `kind='person'`、`visibility='public'`，标签含 `male`/`女性`、两位地区码
    （`fr`/`kr`）、地区中英名与 `多地区`/`regional`；`license_reviewed_at` 已填写。
  - 地区边界：上游明确「国家仅为编辑分组，不推定真实国籍或代表性外貌」，
    描述里固定带该免责声明，且不从地区反推发型/五官/肤色等外观属性。
    无地区条目（男性风格）不会被打上地区码。
  - 上游后续新增人物会自动纳入（按元数据全量导入，不写死 ID）。
- **上游人物库（未导入）**：`data/source/portrait.json` 约 1499 条（893 人脸 +
  606 造型），原站标注 CC0 1.0，但**元数据里没有性别和地区字段**，且单张原图
  约 2MB。目前未导入；如后续需要扩充人像量，需自行补齐性别/地区分类。
- **自建男性姿势**：仓库 `data/custom/pose.json` 中带 `male` 标签的 13 个姿势 ×
  5 视角（共 65 张）属于自建素材，默认条款禁止商用与再分发；本项目已取得维护者单独授权后导入。
  - 导入脚本：`cd apps/api && bun --env-file=../../.env.local run src/scripts/import-pose-male-custom.ts`
  - MinIO：原图 `try-on-references/pose/custom_pose_male_*.png`，缩略图
    `try-on-references/pose/thumbnails/custom_pose_male_*.webp`
  - 数据库：slug `custom_pose_male_XXX_{view}`，标签含 `male` / `男性`，`license_reviewed_at`
    已填写，可被图库接口返回
- **自建男性服饰**：仓库 `data/custom/costume.json` 中带 `male` 标签的 4 套
  （MC-001 礼服 / MC-002 针织 Polo / MC-003 休闲西装 / MC-004 短背心短裤，各一个正面视角）
  同属自建素材、同一份授权。上游写实服饰库（`data/source/costume.json`，约 1405 条）
  没有男性条目，男性服饰目前仅此来源。
  - 导入脚本：`cd apps/api && bun --env-file=../../.env.local run src/scripts/import-costume-custom.ts`
    （该脚本一次导入全部自建服饰：4 套男装 + 40 套自建女装，并按 `male` / `female`
    标签打性别标记；同时给存量上游女装补 `female` / `女性` 标签）
  - MinIO：原图 `try-on-references/costume/custom_costume_male_*.png`，缩略图
    `try-on-references/costume/thumbs/custom_costume_male_*.webp`
  - 数据库：slug `costume-custom_costume_male_00X`，`kind='garment'`，
    标签含 `male` / `男性`，`license_reviewed_at` 已填写，可被图库接口返回
  - 上游后续新增男性服饰会自动纳入（脚本按 `male` 标签过滤，不写死 ID）
- **上游写实服饰（女性）**：`data/source/costume.json` 约 1405 条，
  导入脚本 `src/scripts/seed-ai-try-on-costumes.ts`，storage key 前缀 `costume/`。
  注意该文件 ID 会中途重头编号（默认区块 + 扩展区块），脚本按出现次序消歧。

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
