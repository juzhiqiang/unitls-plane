# 05 - 响应式适配审计

> 依赖：Phase 3
> 预估：2h
> 可并行：所有任务

## 目标

全站响应式审计，确保移动端 (sm)、平板 (md)、桌面 (lg+) 均可用。

## 断点定义

```
sm: 640px   - 大手机
md: 768px   - 平板竖屏
lg: 1024px  - 平板横屏 / 小笔记本
xl: 1280px  - 桌面
2xl: 1536px - 大屏
```

## 审计清单

### 5.1 落地页 (marketing)

- [ ] Hero 区在 sm 下文字大小合适
- [ ] 功能卡片在 sm 下单列堆叠，md 下两列，lg 下三列
- [ ] 导航在 sm 下变为汉堡菜单

### 5.2 应用布局 (app)

- [ ] 侧边栏在 sm 下隐藏，通过抽屉打开
- [ ] AppHeader 在 sm 下隐藏面包屑，只显示菜单按钮 + 用户头像
- [ ] 主内容区在 sm 下 padding 减小（p-4 vs p-6）

### 5.3 图片工具

- [ ] FileDropzone 在 sm 下高度合适
- [ ] 参数面板在 sm 下从右侧改为底部抽屉，或堆叠在 Dropzone 下方
- [ ] 预览对比组件在 sm 下变为上下堆叠

### 5.4 PDF 工具

- [ ] PDF 缩略图网格：sm 1 列、md 2 列、lg 3 列、xl 4 列
- [ ] 文件列表（合并工具）：sm 卡片式、md+ 表格式
- [ ] 拆分参数面板在 sm 下底部 Sheet

### 5.5 字体工具

- [ ] FontPreview 字号 Slider 在 sm 下宽度占满
- [ ] 字形网格在 sm 下 4 列、md 6 列、lg 8 列

### 5.6 Dashboard 页面

- [ ] 文件列表 sm 下单列，更大屏多列
- [ ] 任务历史表格在 sm 下变为卡片列表
- [ ] 过滤工具栏在 sm 下折叠到 dropdown

### 5.7 共性问题

- [ ] 所有 Modal/Dialog 在 sm 下变成 Sheet（底部弹出）
- [ ] 所有 DataTable 横向溢出时支持横滚
- [ ] 表单字段在 sm 下单列
- [ ] 按钮组在 sm 下垂直堆叠

## 验证方法

### Chrome DevTools

测试设备：
- iPhone SE (375px)
- iPhone 12 Pro (390px)
- iPad (768px)
- iPad Pro (1024px)
- Desktop (1440px)

### Playwright 自动化测试

`tests/responsive.spec.ts`:
```typescript
const viewports = [
  { width: 375, height: 667, name: 'mobile' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1440, height: 900, name: 'desktop' },
];

for (const vp of viewports) {
  test(`landing page renders at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/');
    await expect(page).toHaveScreenshot(`landing-${vp.name}.png`);
  });
}
```

## 验收标准

- [ ] 375px 宽度下所有页面无横滚
- [ ] 所有交互元素 ≥ 44px 触摸目标
- [ ] 文字在最小屏幕仍可读（≥ 14px body）
- [ ] 视觉一致性（与桌面端品牌感保持）
