import type { ReactNode } from 'react';

interface ImageGenerateWorkbenchProps {
  title: string;
  /** 左面板主体:参数字段。lg 及以上固定 360px 宽,超高时面板内部滚动。 */
  panel: ReactNode;
  /** 左面板底部固定区:额度行与生成按钮,不随参数滚动。 */
  panelFooter: ReactNode;
  /** 右主区:页面按 空态/生成中/结果 三态传入。 */
  children: ReactNode;
}

/**
 * AI 生图工作台布局骨架(参考设计稿 4a9731b8 的左参数/右预览结构)。
 *
 * 只服务生图页,不做通用抽象:lg 以下右主区在上、参数面板在下自然堆叠;
 * lg 及以上左面板 sticky + 内部滚动,生成按钮吸面板底部。
 */
export function ImageGenerateWorkbench({
  title,
  panel,
  panelFooter,
  children,
}: ImageGenerateWorkbenchProps) {
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <h1 className="text-xl font-medium tracking-tight">{title}</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-4 self-start rounded-md border border-border p-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)]">
          <div className="min-h-0 flex-1 space-y-5 lg:overflow-y-auto lg:pr-1">
            {panel}
          </div>
          <div className="shrink-0 space-y-3">{panelFooter}</div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
