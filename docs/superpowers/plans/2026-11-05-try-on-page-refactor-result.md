# 试衣工作台维护性重构结果

对应实施计划：`docs/superpowers/plans/2026-11-05-core-maintainability.md` Task 2。

## 职责拆分

- `image/try-on/page.tsx` 仅保留工具元信息、工作台 Hook 和展示区域组合，由原 1281 行收敛到 42 行。
- `useTryOnForm.ts` 管理角色选择、上传文件、生成参数、预设应用与场景标签编辑。
- `useTryOnTask.ts`
  管理上传文件 ID 复用、创建任务、轮询合并、失败重试、错误映射及失败后的共享额度刷新。
- `useTryOnWorkbench.ts`
  组合查询和状态，推导提交条件、阶段、已选素材、对比素材、处理提示及快捷键提交。
- `TryOnModePanel.tsx`、`TryOnReferencesPanel.tsx`、`TryOnParametersPanel.tsx` 和
  `TryOnTaskFeedback.tsx` 分别展示模式/额度、四类参考与搭配看板、场景/生成参数、处理/恢复状态。
- `TryOnResult.tsx` 独立拥有单图/对比、复制反馈及图片查看器等展示状态。

各新模块为 62–304 行，未将原页面整体迁移到单一 Hook 或视图。组件直接导入，不修改 ai-try-on 的公开 barrel 入口。

## 行为与文案

保留商品/灵感模式、人像来源、四角色绑定顺序、上传缓存、参数默认值、失败任务重试、失败额度刷新、下载、预览与对比素材优先级。重置仍仅清除选择、场景说明及任务/错误，保留模式、来源和输出参数。

原页面的六组双语场景标签与提示片段移到 `ImageTryOn.workbench.sceneChips`，中英文连接符移到
`ImageTryOn.workbench.sceneDelimiter`。原字符串汇总至本地 `log/try-on-page-messages.json`
并交给主执行者合并；本子任务未直接编辑 messages。

上传 API 的现有 OpenAPI 响应体未声明，生成类型将成功响应推断为 `undefined`，无法直接推断
`id`。消费边界以 `unknown` 接收响应并校验对象及字符串
`id`，移除了原双重类型断言；空响应继续显示原上传失败恢复信息。未改动 API 协议或共享 Hook。

## 验证

1. 修改前原页面测试：1 文件，9/9 通过。
2. 先补上传复用/参数、失败额度刷新/重试、预览/对比三个行为用例：拆分前 12/12 通过，拆分后同样通过。
3. 最终页面测试与
   `UploadReferenceCard`、`TryOnPresetsBar`、`TryOnCompositionStrip`、payload 类型测试：5 文件，30/30 通过。页面共 16 个用例，另覆盖中英场景片段、上传中断后缓存复用和空上传响应。
4. 所有本子任务修改文件执行 Next ESLint：无警告或错误。
5. 使用本地 `log/tsconfig.try-on-page.json`，从原 Web tsconfig 继承并限定 `src` 范围，执行
   `tsc --noEmit`：通过。
6. 原 Web 全量 `tsc --noEmit` 涉及 test/e2e 既有错误（如 Playwright
   `reducedMotion`、jsdom 类型声明、messages 数组与 `AbstractIntlMessages`
   等）；未扩大本次修改范围。集成阶段完整构建与 10 项 E2E 已通过，Web 全套 799 项通过。
7. 将原页面与五个新视图的 `className`、`data-testid`、`id`、`htmlFor`
   静态属性逐项计数比较，完全一致。

## 自审结论

已逐段核对表单、提交、重试、配额失效、素材优先级及组件回调；未发现本次拆分引入的行为回归。处理错误、成功结果和查看器仍按原顺序渲染，React
Fragment 未增加 DOM 包装层。未升级依赖或发布版本，未更新用户更新日志，未单独创建提交，由主执行者统一提交。
