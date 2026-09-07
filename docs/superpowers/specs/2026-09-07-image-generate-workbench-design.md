# AI 生图页面工作台布局改版设计

- 日期:2026-09-07
- 范围:`/image/generate`(apps/web)前端布局与视图层改版
- 参考设计稿:`4a9731b8-25f8-4bc2-95ac-0048ff668ad9.png`(项目根目录)

## 背景与目标

当前 AI 生图页面沿用 `ToolPageShell` 的单列表单布局。参考设计稿(Midjourney 风格工作台)改为「左侧参数面板 + 右侧主区」的工作台结构,提升生图工具的专业感和结果可见性。

**边界决策(已确认):**

- 布局向设计稿靠拢,配色/按钮/卡片沿用项目现有 Tailwind 设计 token,不引入设计稿独立配色;亮暗色跟随全站。
- 不还原设计稿顶部品牌导航栏(与全站 header 重复)。
- 旧 `ToolPageShell` 布局整体替换,不保留 fallback;步骤条与信任条一并移除。
- 方案 A:页面内自建工作台布局,不新建通用 Shell 组件(只有一个使用者,不做过度抽象)。

## 布局结构

```
┌──────────────────────────────────────────────────┐
│ 标题行:AI 生图              今日剩余 {n} / {m} 张 │
├───────────────┬──────────────────────────────────┤
│ 左面板 ~360px │ 右主区(三态)                    │
│ (lg+)固定宽   │ empty:   灵感模板卡片墙          │
│ 内容超高时    │ working: 进度占位 / 失败重试面板  │
│ 内部滚动      │ result:  大图预览 + 缩略切换条    │
│ 生成按钮吸底  │          (图生图嵌入滑动对比)     │
└───────────────┴──────────────────────────────────┘
```

- 左面板:参数从上到下为 模式 → 参考图(图生图时) → 提示词 → 参数组(尺寸/质量/风格/张数,直接展开不再用 details 折叠) → 来源(多来源部署时);底部吸底放生成按钮,额度行在按钮上方。
- 右主区:lg 及以上双栏,lg 以下右主区在上、参数面板在下,自然堆叠。
- 整页仍可向下滚动,右主区不裁切内容。

## 组件结构

```
page.tsx(状态编排 + 提交逻辑,现有 hooks 全部保留)
  ├─ ImageGenerateWorkbench(新)— 布局骨架:标题行 + 左面板 + 右主区插槽
  │    ├─ 左面板 children:复用 ModeField / FileDropzone / PromptField /
  │    │   ParamsFields / ProviderField + 额度行 + 生成按钮
  │    └─ 右主区(页面按三态传入)
  ├─ ImageGenerateTemplateWall(新)— 空态模板卡片墙
  ├─ ProcessingProgress / FailureRecoveryPanel(复用)— working 态
  ├─ ResultPanel 撤出,大图预览为内联实现;
  │   ImageGenerateCompare(复用)— 图生图滑动对比嵌在预览位
  └─ image-generate-options.tsx 四个字段组件原样复用,仅调样式细节
```

## 状态流转

现有状态全部保留:`draft` / `sourceFile` / `comparedFile` / `taskIds` / `submitting` / `failure` / `output.previews` / `items`(useTaskGroupProgress)/ `busy` 派生。

新增:

- `selectedIndex: number`(默认 0)— 结果态下当前展示哪张图;缩略条点击切换;新一轮生成时重置为 0。

右主区三态派生规则:

- `empty`:无 taskIds 且无 failure(且非 submitting)→ 模板墙。
- `working`:submitting || inFlight || fetchingResults → 进度占位;failure 非空时叠加失败重试面板。
- `result`:已有完成的 previews 可展示;若部分任务仍在 working,保持 working 态为主、完成图先可预览(与现状一致:大图 + 逐张出现)。

## 空态模板墙

- 复用 `GET /tasks/image-generate/presets` 接口(`useImageGeneratePresets`)与 `presetImageUrl`,无新接口。
- 卡片:大示例图(aspect 约 4/3,网格 2-3 列自适应)+ 标题 + 提示词摘要(line-clamp);点击填入提示词输入框并聚焦。
- presets 为空或加载失败时不渲染模板墙,退化为简单的空态引导文案(提示在左侧输入提示词)。

## 文案与 i18n

- 新增键(zh/en 同步):`templateWallTitle`、`templateWallEmpty`(接口空/失败时的引导)、`thumbnailLabel`(缩略切换 aria)、`selectResult`(选中态 aria 文案)。
- 删除键:`paramsSummary`(参数组不再折叠)。
- 其余现有键不动。

## 测试

- 现有 `page.test.tsx` 用例适配新 DOM 结构后保留(提交逻辑、配额、错误码分支不变)。
- 新增关键测试:
  1. 空态渲染模板墙,点击模板卡片填入提示词;
  2. 生成完成后展示大图 + 缩略切换条,`selectedIndex` 切换生效;
  3. working 态展示进度占位,失败展示重试面板。

## 不做的事

- 不动 API、validators、任务流程、配额逻辑与任何后端代码。
- 不改其他工具页;`ToolPageShell` 本身不修改(其他页面继续使用)。
- 不做左面板折叠、不做结果历史持久化(仍为本次会话内结果)。
- 不引入设计稿的深色玻璃风格、品牌栏、搜索框。
