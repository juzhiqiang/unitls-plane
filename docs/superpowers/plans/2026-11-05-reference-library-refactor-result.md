# 参考图库维护性重构结果

本次仅实施核心维护性计划的 Task 3。公开的 `ReferenceLibraryGridProps`
保持兼容，默认分页大小、筛选切换规则、素材选择与可选清空规则保持不变。

## 职责划分

- `referenceLibrary.ts`：姿势视角识别与聚合、固定方向排序与去重、性别与服装风格分类、筛选计数、搜索匹配、当前姿势方向优先级。
- `ReferenceLibraryGrid.tsx`：公开入口、筛选和分页状态、素材选择与弹窗编排，从 1176 行缩减到 308 行。
- `ReferenceLibraryCard.tsx`：普通素材卡片、标签、性别标记、许可和来源链接。
- `ReferenceLibraryPoseCard.tsx`：姿势卡片与多方向切换。
- `ReferenceLibrarySummary.tsx`：已选摘要、大图入口、摘要方向切换、快捷推荐和图库入口。
- `ReferenceLibraryFilters.tsx`：性别、风格与搜索控件。
- `ReferenceLibraryModal.tsx`：弹窗框架、键盘交互、分页和确认栏。

抽取时保留原有 DOM 层次、类名、图片比例和测试标识。没有添加依赖、修改共享 API 类型或改变图库数据协议。

## 文案

原组件内的硬编码中英文显示文案统一使用 `ImageTryOn.referenceLibrary`。中英文键树交接文件为本地
`log/reference-library-messages.json`，由主执行者合并到两份 messages；本子任务未直接修改 messages。已有加载、错误、许可、来源、清空等通用
`ImageTryOn` 键继续复用。

## 行为保护与验证

先新增 6 个真实组件行为用例并在原实现上通过，再执行抽取。最终新增 9 个组件行为用例和 5 个领域行为用例，覆盖：

- 多视角分组、首次重复方向优先、完整方向顺序、文件名识别优先与标签回退。
- 任意方向的标题、描述、标签搜索；大小写和前后空格处理。
- 性别默认值、组级计数、服装分类优先级、性别内的风格统计和组合筛选。
- 搜索与筛选重置分页、空结果、键盘翻页、数据缩减后的页码约束。
- 快捷选择、摘要方向选择、可选清空、禁用状态、已选预览、许可与来源链接、错误恢复动作。

抽取自审时补充了连续键盘事件用例，发现并复现函数式状态更新被替换后丢失连续翻页的回归（期望第 3 页、实际第 2 页），恢复函数式更新后该用例通过。

验证结果：

- `bun run test test/components/tools/ai-try-on/ReferenceLibraryGrid.test.tsx test/components/tools/ai-try-on/referenceLibrary.test.ts`：2 个文件、14 个测试通过。
- 对本次 7 个源码文件、2 个测试文件执行 `next lint --file ...`：无警告或错误。
- `prettier --check`：本次源码和测试均通过。
- Web 全套集成复跑：118 个测试文件、799 个测试全部通过。旧源码文本测试对入口文件的结构约束，已由试衣页面实际渲染的结果与失败恢复行为测试替代。
- 额外执行 `tsc --noEmit --incremental false`：全仓存在测试与 E2E 类型错误，并在并行修改中的
  `useTryOnTask.ts`
  出现类型错误，后者已在集成阶段修正；生产构建通过。本子任务源码与测试无类型诊断。中途检查完整输出保留于本地
  `log/reference-library-tsc.log`。

## 自审与交接

逐一核对分组键、首方向与选中方向优先级、服装分类顺序、风格统计不受搜索影响、切换性别清空风格、模态卡片选择后关闭与清空时保持打开、方向切换不关闭、许可链接和原 CSS 类名。未发现尚未处理的图库回归。

集成阶段全套 10 项 Playwright 测试通过，其中包含中英文试衣与图库选择；静态 DOM/CSS 属性已核对，本轮未额外制作截图像素对比。Git 提交由主执行者统一创建。
