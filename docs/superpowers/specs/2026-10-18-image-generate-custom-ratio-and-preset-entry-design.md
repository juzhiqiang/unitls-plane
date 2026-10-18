# AI 生图：自定义画面比例 + 模板随时调出 设计文档

日期：2026-10-18
状态：已确认（待实现）

## 背景与目标

生图页（`/image/generate`）参数面板的「画面比例」行目前只能从模型声明的固定档位（`sizes`）里选，用户想要 21:9 这类非档位比例时没有出路。同时提示词模板（`image_generate_presets`）只在空画布态可见——一旦会话有了消息，模板就再也调不出来了。

目标：

1. 画面比例支持自定义输入（比例 `W:H` 或尺寸 `WxH`），模型有等比档位则映射到档位，没有则按用户输入的比例合成尺寸提交。
2. 模板入口除了空态，在参数设置面板里也能随时调出，选中即填入输入框。

非目标：

- 不做自定义比例的持久化/记住上次输入（会话内有效即可）。
- 不做模板管理（后台 CRUD 已明确为后续工作）。
- 不改变现有档位 chip 的行为。

## 功能 1：自定义画面比例

### 交互

`SettingsPanel` 画面比例行末尾新增「自定义」chip，**常显**（与模型是否支持无关）：

- **模型支持自定义尺寸**（`customSizes: true`，见下）→ chip 可点，点开出现内联输入区：一个文本输入框 + 确认按钮。接受 `W:H`（比例，如 `21:9`）或 `WxH`（尺寸，如 `1920x824`）两种写法。
- **模型不支持** → chip 置灰（`disabled`），`title` 悬停提示「当前模型不支持自定义比例」。
- 选中自定义后 chip 高亮，输入框常驻在比例行下方显示当前值与「清除」操作（清除回到「自动」档）。

### 解析与合成规则（`resolveCustomRatio`，前端）

输入解析（正则 `^\s*(\d{1,4})\s*[:xX]\s*(\d{1,4})\s*$`，两个数值均在 16–4096 且至少一边 ≥ 64）：

1. 解析失败 → 输入框下方红字提示，不修改草稿。
2. 解析出比例 `W:H`：
   - 与某档位的约分比例**完全相等**（现有 `sizeToRatioLabel` 逻辑比对）→ 草稿 `size` 设为该档位原串（如输 `16:9` → `1536x864`），chip 状态切到对应档位（视觉上等同选中该档位，但输入框保留用户输入的 `16:9` 文本）。
   - 无等比档位 → 合成尺寸：**长边 1536**，短边 = round(1536 × 短边/长边) 并取整到 16 的倍数，写入草稿 `size`（如 `21:9` → `1536x656`）。合成值在输入区下方以小字展示「实际提交：1536x656」。
3. 解析出尺寸 `WxH`：草稿 `size` 直接用 `WxH`（模型支持自定义时原样提交；如果碰巧等比某档位也直接用原串，不做换算）。

草稿 `size` 仍是一个字符串（`auto` / 档位 / 合成的 `WxH`），`ImageGenerateChatDraft` 结构不变——自定义状态由 size 串本身表达，刷新/换模型后 `resolveDraftSize` 的比例最近邻逻辑自然兜底（不改这段）。

### 后端：模型级 `customSizes` 声明

问题：`ImageGenerationService.orderCandidates`（`image-generation.service.ts:800` 起）对候选来源按 `entry.model.sizes.includes(config.size)` 交叉过滤，自定义尺寸会全部被滤掉、抛 `AI_IMAGE_PROVIDER_UNAVAILABLE`。

改动（`apps/api/src/modules/tasks/services/image-provider-config.ts` + `image-generation.service.ts`）：

1. `imageProviderModelSchema` 增加可选布尔字段 `customSizes`（默认 `false`）。默认关的理由：严格网关（OpenAI 官方等）收到未声明尺寸会 400，是否放开由部署者按网关行为自己判断；`.env.example` 配置注释写明。
2. `orderCandidates` 的过滤改为：`entry.model.customSizes === true` 时跳过尺寸过滤（能力过滤保留）；未声明或 `false` 维持现状。
3. `listModels()` 模型归并（`displayAs ?? name` 去重）时，`customSizes` 取各来源的**或**（任一来源声明即支持），随 `GET /tasks/image-generate/models` 下发，字段名 `customSizes`（同 `capabilities`/`sizes` 的归并套路，`image-generation.service.ts:772-790`）。
4. `packages/validators` 的 models 响应若有过校验需同步（检查后按需）。

### 校验边界

- 前端解析即限制 16–4096 / 至少一边 ≥ 64，避免 `1x1`、`99999x99999`。
- 后端 `imageGenerateSizeSchema`（`packages/validators/src/image-generate.ts:14`）已允许任意 `\d{2,5}x\d{2,5}`，无需放宽；`customSizes` 只影响路由过滤，不触碰 schema。

## 功能 2：设置面板里的模板入口

### 交互

`SettingsPanel` 面板底部（生成数量行之后）新增「提示词模板」入口行：

- 一个带 Sparkles 图标的按钮文案「选择提示词模板」。
- `presets` 为空（未配置/接口失败）→ 整行不渲染（与空态的退化逻辑一致：空弹窗比没有入口更困惑）。
- 点击打开与空态**同一个**模板弹窗，选中即调 `onPick(prompt)` 填入输入框并关闭弹窗（不关闭设置面板本身，用户可能还要调参数）。

### 组件抽取

模板弹窗从 `empty-state.tsx` 抽成共享组件 `apps/web/src/components/tools/image-generate/preset-picker-dialog.tsx`：

```tsx
interface PresetPickerDialogProps {
  presets: ImageGeneratePresetDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  onPick: (prompt: string) => void;
}
```

- `EmptyState` 改为渲染 `<PresetPickerDialog>`（「更多模板」触发逻辑不变），删除内部弹窗实现。
- `SettingsPanel` 新增 `presets` 与 `onPickPreset` props，内部持有弹窗 open 状态。
- 事件链：`page.tsx` 已有 `pickPreset`（填入草稿 + 聚焦输入框）→ `PromptComposer` 透传（新增 `presets`、`onPickPreset` props）→ `SettingsPanel`。`presetsQuery.data` 在 page 层已有，直接下传。

## i18n

`apps/web/messages/zh.json` / `en.json` 的 `ImageGenerate` 命名空间新增：

- `ratioCustom`：自定义
- `ratioCustomTitle`：自定义画面比例
- `ratioCustomPlaceholder`：如 21:9 或 1920x824
- `ratioCustomInvalid`：请输入 W:H 或 WxH（16–4096）
- `ratioCustomApplied`：实际提交：{size}
- `ratioCustomUnsupported`：当前模型不支持自定义比例
- `ratioCustomClear`：清除自定义比例
- `settingsPresetsLabel`：提示词模板
- `settingsPresetsTrigger`：选择提示词模板

（`presetTitle`/`presetDescription`/`presetClose` 复用现有键。）

## 测试

前端（vitest，目录 `apps/web/test/`）：

- `components/tools/image-generate-types.test.ts` 增补 `resolveCustomRatio`：等比映射（`16:9` → `1536x864`）、合成（`21:9` → `1536x656`）、直传尺寸（`1920x824`）、非法输入返回 null。
- settings-panel 测试（新建或并入页面测试）：支持时 chip 可点且能解析输入；不支持时置灰带 title；面板出现模板入口行、presets 为空时不渲染；选中模板调 onPickPreset。
- page 测试：pickPreset 透传链路。

后端（bun test，`apps/api/test/modules/tasks/`）：

- `customSizes: true` 的模型收到非档位尺寸 → 路由通过、正常提交上游。
- 未声明 `customSizes` 的模型收到非档位尺寸 → 仍按 `AI_IMAGE_PROVIDER_UNAVAILABLE` 拒绝（防回归）。
- `listModels()` 归并时 `customSizes` 取或。

## 涉及文件清单

前端：

- `apps/web/src/components/tools/image-generate/types.ts`（`resolveCustomRatio`）
- `apps/web/src/components/tools/image-generate/settings-panel.tsx`（自定义 chip + 输入区 + 模板入口行）
- `apps/web/src/components/tools/image-generate/preset-picker-dialog.tsx`（新建，从 empty-state 抽出）
- `apps/web/src/components/tools/image-generate/empty-state.tsx`（改用共享弹窗）
- `apps/web/src/components/tools/image-generate/prompt-composer.tsx`（透传 presets/onPickPreset）
- `apps/web/src/app/[locale]/(app)/image/generate/page.tsx`（下传 presets/pickPreset）
- `apps/web/messages/{zh,en}.json`

后端：

- `apps/api/src/modules/tasks/services/image-provider-config.ts`（schema + 默认值）
- `apps/api/src/modules/tasks/services/image-generation.service.ts`（orderCandidates 过滤 + listModels 归并）
- `apps/api/src/scripts/` 无需动（seed 是 presets，不是 providers）
- `.env.example`（AI_IMAGE_PROVIDERS 注释补 customSizes 说明）

测试：如上节所列。

## 风险与边界

- 自定义尺寸合成值（如 1536x656）发给未声明 customSizes 的网关会被前端 `resolveDraftSize` 在提交前兜底映射（比例最近邻）——但既然 chip 已按模型能力置灰，正常路径不会走到这。防御性兜底保留，双保险。
- 多来源同模型（displayAs 归并）时，只要有一个来源声明 customSizes 就整组放行，路由会把请求分到**该模型全部候选来源**（含不支持的）——与 capabilities 取或的现状一致（既有行为，不在本次修改）。
- OpenAPI 导出与 api-client 重新生成（models 端点响应加了字段）。
