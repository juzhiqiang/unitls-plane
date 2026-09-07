'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * 滚动消息流。有子内容时滚到底(新消息/任务完成都能第一时间可见);
 * 用户主动上滚翻历史时不抢滚动位置。
 */
export function MessageCanvas({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // 只有滚动条接近底部(48px 内)时才自动跟随,上滚看历史不被打断。
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < 48) {
      container.scrollTop = container.scrollHeight;
    }
  });

  return (
    <div
      ref={containerRef}
      className="preview-scroll h-full overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-4 lg:p-6">
        {children}
      </div>
    </div>
  );
}
