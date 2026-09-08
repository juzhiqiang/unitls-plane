'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface MessageCanvasProps {
  /** 当前消息组数量:变化即视为「来了新消息」,无条件滚到底。 */
  messageCount: number;
  children: ReactNode;
}

/**
 * 滚动消息流。
 *
 * - 新消息(消息组数量变化,含乐观消息出现):无条件滚到底,不管用户当前滚在哪;
 * - 已有内容的更新(任务进度、图片取回):只在本来就贴近底部(48px 内)时跟随,
 *   用户上滚翻历史时不抢滚动位置。
 */
export function MessageCanvas({
  messageCount,
  children,
}: MessageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(messageCount);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isNewMessage = messageCount !== lastCountRef.current;
    lastCountRef.current = messageCount;
    if (isNewMessage) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
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
