# 06 - 字体预览组件

> 依赖：Phase 3 完成
> 预估：1.5h

> **🎨 UI 设计要求**：字体本身就是设计主体，预览区**必须**：
> 1. 先读 [`task/design-system.md`](../design-system.md)
> 2. 调用 `frontend-design` skill 产出方案
> 3. 字体信息卡：mono 字体 + tracking-wider 全大写标签（如 `FONT NAME / GLYPHS`）
> 4. 预览文本区：纯净大留白，**字体本身是英雄**，背景极简
> 5. 字号 Slider：1px 轨道、2px 圆点，无填充色，仅 accent 描边
> 6. 字形网格：8 列网格，每格 1px 边框，hover 显示 Unicode 编号

## 目标

实现前端字体预览组件，加载用户字体文件，展示字体效果。

## 步骤

### 6.1 安装依赖

```bash
cd apps/web
bun add opentype.js
```

### 6.2 创建字体加载工具

`src/lib/processing/font-client.ts`:
```typescript
import opentype from 'opentype.js';

export interface FontInfo {
  fontFamily: string;
  fontSubfamily: string;
  fullName: string;
  glyphCount: number;
  unitsPerEm: number;
}

export async function loadFontInfo(file: File): Promise<FontInfo> {
  const buffer = await file.arrayBuffer();
  const font = opentype.parse(buffer);
  return {
    fontFamily: font.names.fontFamily?.en ?? 'Unknown',
    fontSubfamily: font.names.fontSubfamily?.en ?? 'Regular',
    fullName: font.names.fullName?.en ?? 'Unknown',
    glyphCount: font.glyphs.length,
    unitsPerEm: font.unitsPerEm,
  };
}

export async function loadFontAsCSS(file: File): Promise<string> {
  const fontName = `preview-font-${Date.now()}`;
  const url = URL.createObjectURL(file);

  const fontFace = new FontFace(fontName, `url(${url})`);
  await fontFace.load();
  document.fonts.add(fontFace);

  return fontName;
}
```

### 6.3 字体预览组件

`src/components/tools/font-preview.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { loadFontAsCSS, loadFontInfo, type FontInfo } from '@/lib/processing/font-client';

export function FontPreview({ file }: { file: File }) {
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [info, setInfo] = useState<FontInfo | null>(null);
  const [previewText, setPreviewText] = useState(
    'The quick brown fox jumps over the lazy dog\n敏捷的棕色狐狸跳过了懒狗\n0123456789'
  );
  const [fontSize, setFontSize] = useState(32);

  useEffect(() => {
    let active = true;
    (async () => {
      const [name, fontInfo] = await Promise.all([
        loadFontAsCSS(file),
        loadFontInfo(file),
      ]);
      if (!active) return;
      setFontFamily(name);
      setInfo(fontInfo);
    })();
    return () => { active = false; };
  }, [file]);

  return (
    <div className="space-y-4">
      {info && (
        <Card>
          <CardHeader>
            <CardTitle>{info.fullName}</CardTitle>
            <CardDescription>{info.fontFamily} - {info.fontSubfamily}</CardDescription>
          </CardHeader>
          <CardContent>
            <p>字形数：{info.glyphCount} · 单位：{info.unitsPerEm}</p>
          </CardContent>
        </Card>
      )}

      <div>
        <Label>预览文本</Label>
        <Textarea value={previewText} onChange={(e) => setPreviewText(e.target.value)} />
      </div>

      <div>
        <Label>字号 ({fontSize}px)</Label>
        <Slider value={[fontSize]} min={12} max={96} onValueChange={([v]) => setFontSize(v)} />
      </div>

      <div
        className="border rounded p-6 whitespace-pre-wrap"
        style={{ fontFamily: fontFamily ?? 'inherit', fontSize: `${fontSize}px`, lineHeight: 1.5 }}
      >
        {previewText}
      </div>
    </div>
  );
}
```

### 6.4 字形网格组件（可选）

显示前 N 个字形预览：
```tsx
<div className="grid grid-cols-8 gap-2">
  {glyphs.slice(0, 64).map(g => (
    <div className="border aspect-square flex items-center justify-center" style={{ fontFamily }}>
      {String.fromCodePoint(g.unicode)}
    </div>
  ))}
</div>
```

### 6.5 卸载时清理

```typescript
useEffect(() => {
  return () => {
    // 移除已加载的 font face
    document.fonts.forEach(f => {
      if (f.family === fontFamily) document.fonts.delete(f);
    });
  };
}, [fontFamily]);
```

## 验收标准

- [ ] 上传 TTF 后能正确显示字体名
- [ ] 自定义文本能用上传字体渲染
- [ ] 字号 Slider 实时调整
- [ ] 中英文混排正常
- [ ] 卸载后清理资源
