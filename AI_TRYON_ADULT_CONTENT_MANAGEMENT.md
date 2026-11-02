# AI试衣姿势图库 - 成人内容管理方案

## 需求概述

用户要求将所有姿势(包括成人内容)都保留在MinIO中,但通过数据库的`visibility`字段控制前端可见性:

1. **公开姿势** (`visibility='public'`) - 前端可见,38个电商适用姿势
2. **成人内容** (`visibility='adult'`) - MinIO保留,前端不可见
   - R18、性暗示姿势(正常位、骑乘位、后入位等)
   - M字开腿等性暗示分类
3. **亲密接触** (`visibility='intimate'`) - MinIO保留,前端不可见
   - 贴身、立位贴身等亲密接触姿势
   - 双人姿势
4. **隐藏内容** (`visibility='hidden'`) - MinIO保留,前端不可见
   - 不适合电商但非成人的姿势
   - 默认种子姿势(A-pose、T-pose、Walking)
   - 挤胸、过度后仰等

## 已完成工作

### 1. Schema更新 ✅
- 添加`ai_try_on_reference_visibility` enum (public/hidden/adult/intimate)
- 在`ai_try_on_references`表添加`visibility`列,默认值`public`
- Migration: `packages/db/drizzle/0023_familiar_thor.sql`

### 2. API层过滤 ✅
- `apps/api/src/modules/tasks/services/ai-try-on-references.service.ts`
- `list()` 方法添加 `eq(aiTryOnReferences.visibility, 'public')` 过滤
- `getImageForGeneration()` 方法添加同样过滤
- **结果**: API只返回public内容,前端看不到adult/intimate/hidden

### 3. 当前问题 ⚠️
之前的删除脚本(`apps/api/src/scripts/delete-inappropriate-poses.ts`)不仅删除了数据库记录,还删除了MinIO文件。

需要:
1. 重新从GitHub下载被删除的23个姿势图片
2. 上传到MinIO (保持原路径)
3. 插入数据库记录并标记正确的visibility

## 文件分类明细

### Adult (6个)
```
full_sexy_P018_front - M字开腿1
full_sexy_P019_front - M字开腿2  
full_sexy_P051_front - 性感大胆1
full_sexy_P052_front - 性感大胆2
full_sexy_P053_front - 性感大胆3
full_sexy_P054_front - 性感大胆4
```

### Intimate (8个)
```
pair60_P001_front - 立位贴身1
pair60_P030_front - 立位贴身2
pair60_P052_front - 立位贴身3
pair60_P053_front - 立位贴身4
pair60_P009_front - 背向坐位1
pair60_P010_front - 背向坐位2
pair60_P016_front - 背向坐位3
pair60_P019_front - 背向坐位4
```

### Hidden (9个)
```
a.png - A-pose站姿
t.png - T-pose站姿
walk.png - 行走姿势
full_sexy_P026_front - 挤胸姿势1
full_sexy_P028_front - 挤胸姿势2
full_sexy_P029_front - 挤胸姿势3
full_sexy_P033_front - 过度后仰1
full_sexy_P048_front - 过度后仰2
full_sexy_P049_front - 过度后仰3
```

## 下一步行动

### 步骤1: 运行Migration
```bash
cd packages/db
bunx drizzle-kit migrate
```

### 步骤2: 下载并恢复文件
创建脚本 `apps/api/src/scripts/download-and-restore-adult-poses.ts`:
- 从GitHub下载23个被删除的姿势图片
- 上传到MinIO的try-on-references桶
- 插入数据库记录并标记visibility

### 步骤3: 验证
1. 检查MinIO: 所有61个姿势文件都应存在
2. 检查数据库: 61条记录,38个public + 23个非public
3. 检查API: `/tasks/ai-try-on/references?kind=pose` 只返回38个
4. 检查前端: 姿势图库只显示38个公开姿势

## 数据库状态对比

### 之前(删除后)
```sql
SELECT COUNT(*) FROM ai_try_on_references WHERE kind = 'pose';
-- 38条 (只有public)
```

### 预期(恢复后)
```sql
SELECT visibility, COUNT(*) 
FROM ai_try_on_references 
WHERE kind = 'pose'
GROUP BY visibility;

--  visibility | count
-- ------------+-------
--  public     |    38
--  adult      |     6
--  intimate   |     8
--  hidden     |     9
-- 总计: 61
```

## API响应对比

### GET /tasks/ai-try-on/references?kind=pose

**之前和之后的返回都一样**:只返回38个public姿势

区别在于:
- 之前: 数据库只有38条记录,MinIO只有38个文件
- 之后: 数据库有61条记录,MinIO有61个文件,但API筛选后只返回38个

## 安全保证

1. **前端无法访问隐藏内容**
   - API层强制过滤`visibility='public'`
   - 即使猜测ID也无法获取hidden/adult/intimate内容

2. **MinIO文件保留**
   - 所有61个文件保留在MinIO
   - 便于将来管理、审核或调整分类
   - 可随时通过修改visibility字段调整可见性

3. **灵活的内容管理**
   - 需要恢复某个姿势: UPDATE visibility='public'
   - 需要完全删除: DELETE记录 + 删除MinIO文件
   - 需要重新分类: UPDATE visibility字段

## 提交信息

```
feat(ai-try-on): 添加姿势图库visibility分类管理

- 添加visibility enum (public/hidden/adult/intimate)
- API层强制只返回public内容
- 恢复23个成人/亲密/隐藏姿势到MinIO和数据库
- 前端保持38个公开姿势可见,其他内容仅后台保留
- 支持灵活的内容分类和可见性管理

Migration: 0023_familiar_thor.sql
```

## 相关文件

- Schema: `packages/db/src/schema/ai-try-on-references.ts`
- Migration: `packages/db/drizzle/0023_familiar_thor.sql`
- Service: `apps/api/src/modules/tasks/services/ai-try-on-references.service.ts`
- 恢复脚本: `apps/api/src/scripts/restore-adult-poses.ts` (待创建完整版)
