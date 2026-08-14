# 图片压缩默认尺寸与完整对比 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让图片压缩默认保留原始尺寸，并让处理前后对比完整显示图片内容。

**Architecture:**
将压缩页默认选项提取为可测试常量，继续复用现有尺寸解析逻辑。图片对比组件读取原图自然宽高，以 480px 为最大高度计算自适应容器宽度；浏览器端滑块负责填满容器，并显式使用
`contain` 显示两张图片。

**Tech Stack:** Next.js 14、React 18、TypeScript、Tailwind
CSS、react-compare-slider、Vitest、Testing Library

---

### Task 1: 默认使用原始尺寸

**Files:**

- Modify: `apps/web/src/app/[locale]/(app)/image/compress/page.tsx`
- Test: `apps/web/src/app/[locale]/(app)/image/compress/__tests__/page.test.ts`

- [ ] **Step 1: 写失败测试**

在现有页面辅助函数测试中导入 `DEFAULT_IMAGE_COMPRESS_OPTIONS`，并断言：

```ts
expect(DEFAULT_IMAGE_COMPRESS_OPTIONS.sizePreset).toBe('original');
```

- [ ] **Step 2: 验证测试失败**

运行：

```bash
bun --cwd apps/web test -- --run 'src/app/[locale]/(app)/image/compress/__tests__/page.test.ts'
```

预期：失败，提示 `DEFAULT_IMAGE_COMPRESS_OPTIONS` 尚未导出或默认值不是 `original`。

- [ ] **Step 3: 写最小实现**

在压缩页导出默认配置，并用于初始化状态：

```ts
export const DEFAULT_IMAGE_COMPRESS_OPTIONS: ImageCompressOptionsState = {
  quality: 80,
  sizePreset: 'original',
  customWidth: 1920,
  customHeight: 1080,
  outputType: 'image/jpeg',
};

const [options, setOptions] = useState<ImageCompressOptionsState>(DEFAULT_IMAGE_COMPRESS_OPTIONS);
```

- [ ] **Step 4: 验证测试通过**

运行同一测试文件，预期全部通过。

### Task 2: 完整展示对比图片

**Files:**

- Modify: `apps/web/src/components/tools/image-compare.tsx`
- Modify: `apps/web/src/components/tools/image-compare-slider.client.tsx`
- Create: `apps/web/src/components/tools/__tests__/image-compare-slider.test.tsx`
- Modify: `apps/web/src/components/tools/__tests__/image-compare.test.tsx`

- [ ] **Step 1: 写失败测试**

为滑块库提供轻量 mock，渲染 `ImageCompareSlider`
后断言根容器填满外部框架，并断言两张图片都收到完整适配样式：

```tsx
expect(screen.getByTestId('compare-slider')).toHaveClass('h-full', 'w-full');
expect(screen.getByAltText('Original')).toHaveStyle({
  objectFit: 'contain',
  objectPosition: 'center',
});
expect(screen.getByAltText('Result')).toHaveStyle({
  objectFit: 'contain',
  objectPosition: 'center',
});
```

在 `image-compare.test.tsx` 中测试纯布局函数：

```ts
expect(getImageCompareFrameStyle(4 / 3)).toMatchObject({
  aspectRatio: 4 / 3,
  width: '100%',
  maxWidth: '640px',
});
```

- [ ] **Step 2: 验证测试失败**

运行：

```bash
bun --cwd apps/web test -- --run src/components/tools/__tests__/image-compare.test.tsx src/components/tools/__tests__/image-compare-slider.test.tsx
```

预期：失败，因为滑块仍使用固定 `aspect-video`，图片未传入 `contain`，布局函数不存在。

- [ ] **Step 3: 写最小实现**

在 `image-compare.tsx` 中加入布局函数，并在对象 URL 创建后加载原图自然尺寸：

```ts
const IMAGE_COMPARE_MAX_HEIGHT = 480;

export function getImageCompareFrameStyle(aspectRatio: number) {
  return {
    aspectRatio,
    width: '100%',
    maxWidth: `${Math.round(IMAGE_COMPARE_MAX_HEIGHT * aspectRatio)}px`,
  };
}
```

仅在 URL 与有效宽高比准备完成后渲染滑块，将现有固定 16:9 外框改成居中、自适应的框架。动态加载占位改为
`h-full w-full`。

在 `image-compare-slider.client.tsx` 中让滑块填满框架，并给两张图片传入相同样式：

```tsx
const imageStyle = {
  objectFit: 'contain' as const,
  objectPosition: 'center',
};

<ReactCompareSliderImage src={originalUrl} alt="Original" style={imageStyle} />
<ReactCompareSliderImage src={resultUrl} alt="Result" style={imageStyle} />
```

- [ ] **Step 4: 验证测试通过**

运行两处组件测试，预期全部通过。

### Task 3: 全量验证与提交

**Files:**

- Verify: `apps/web/src/app/[locale]/(app)/image/compress/page.tsx`
- Verify: `apps/web/src/components/tools/image-compare.tsx`
- Verify: `apps/web/src/components/tools/image-compare-slider.client.tsx`

- [ ] **Step 1: 运行 Web 测试**

```bash
bun run test:web
```

预期：所有 Web 测试通过。

- [ ] **Step 2: 运行格式检查与构建**

```bash
bun run format:check:changed
bun --cwd apps/web run build
```

预期：两个命令退出码均为 0。

- [ ] **Step 3: 浏览器核对**

在桌面与移动视口上传一张横图和一张竖图，确认原始尺寸默认选中、图片没有裁切、滑块可拖动且布局没有溢出。

- [ ] **Step 4: 提交实现**

```bash
git add apps/web/src/app/[locale]/(app)/image/compress/page.tsx \
  apps/web/src/app/[locale]/(app)/image/compress/__tests__/page.test.ts \
  apps/web/src/components/tools/image-compare.tsx \
  apps/web/src/components/tools/image-compare-slider.client.tsx \
  apps/web/src/components/tools/__tests__/image-compare.test.tsx \
  apps/web/src/components/tools/__tests__/image-compare-slider.test.tsx \
  docs/superpowers/plans/2026-08-14-image-compress-default-size-and-compare.md
git commit -m "fix(web): 修复图片压缩默认尺寸与完整对比"
```
