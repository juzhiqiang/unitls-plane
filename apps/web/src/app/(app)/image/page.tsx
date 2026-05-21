'use client';

import Link from 'next/link';
import { ImageDown, RefreshCw } from 'lucide-react';

const tools = [
  {
    title: '图片压缩',
    description: '减小图片文件大小，保持视觉质量',
    href: '/image/compress',
    icon: ImageDown,
  },
  {
    title: '格式转换',
    description: '在 JPEG / PNG / WebP / AVIF 之间互转',
    href: '/image/convert',
    icon: RefreshCw,
  },
];

export default function ImagePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-lg font-medium">图片工具</h1>
        <p className="text-sm text-muted-foreground mt-1">
          选择一个工具开始处理图片
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group border border-border rounded-md p-6 space-y-3 transition-colors hover:bg-muted/40"
          >
            <tool.icon
              className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors"
              strokeWidth={1.5}
            />
            <div className="text-sm font-medium">{tool.title}</div>
            <div className="text-xs text-muted-foreground">
              {tool.description}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}