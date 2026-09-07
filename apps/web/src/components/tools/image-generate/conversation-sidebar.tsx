'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Trash2 } from 'lucide-react';
import type { ImageGenerateSessionDto } from '@/hooks/api/types';

interface ConversationSidebarProps {
  sessions: ImageGenerateSessionDto[];
  /** 本地新建、尚未提交任何任务的会话(侧栏里置顶显示为「新对话」)。 */
  newSessionId: string;
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  /** 删除会话(任务与关联文件一并硬删);由页面处理激活态切换与缓存刷新。 */
  onDelete: (sessionId: string) => void;
  /** 删除请求进行中,禁掉重复点击。 */
  deletingSessionId?: string | null;
}

function formatRelativeTime(iso: string, locale: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return locale === 'en' ? 'just now' : '刚刚';
  if (minutes < 60) {
    return locale === 'en' ? `${minutes}m ago` : `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === 'en' ? `${hours}h ago` : `${hours} 小时前`;
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * 会话历史侧栏:新对话、搜索、会话列表(可删除,行内二次确认)。
 *
 * 搜索只对已加载的列表做客户端 title 过滤 —— 服务端列表上限 50 条,
 * 为这个量级加服务端搜索不值得。桌面端是固定列;移动端由页面用 Sheet 包住复用。
 */
export function ConversationSidebar({
  sessions,
  newSessionId,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
  deletingSessionId,
}: ConversationSidebarProps) {
  const t = useTranslations('ImageGenerate');
  const locale = useLocale();
  const [keyword, setKeyword] = useState('');
  /** 行内二次确认的会话 id:硬删除不可恢复,误触代价太高。 */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const filtered = sessions.filter(
    session =>
      keyword.trim().length === 0 || session.title.includes(keyword.trim())
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onNew}
        className="flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-md bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        {t('newChat')}
      </button>

      <input
        type="search"
        value={keyword}
        placeholder={t('searchSessions')}
        onChange={event => setKeyword(event.target.value)}
        className="h-8 w-full shrink-0 rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />

      <nav
        aria-label={t('sidebarTitle')}
        className="preview-scroll min-h-0 flex-1 overflow-y-auto"
      >
        <ul className="space-y-1">
          <li>
            <button
              type="button"
              onClick={onNew}
              aria-current={activeSessionId === newSessionId}
              className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                activeSessionId === newSessionId
                  ? 'bg-muted font-medium'
                  : 'hover:bg-muted/60'
              }`}
            >
              {t('newChat')}
            </button>
          </li>
          {filtered
            .filter(session => session.sessionId !== newSessionId)
            .map(session => (
              <li key={session.sessionId}>
                {confirmingId === session.sessionId ? (
                  <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
                    <p className="text-xs text-foreground">
                      {t('deleteSessionConfirm')}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={deletingSessionId === session.sessionId}
                        onClick={() => {
                          onDelete(session.sessionId);
                          setConfirmingId(null);
                        }}
                        className="flex-1 rounded-md bg-destructive px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingSessionId === session.sessionId
                          ? t('deletingSession')
                          : t('deleteSessionConfirmYes')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="flex-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/60"
                      >
                        {t('deleteSessionConfirmNo')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`group flex items-center gap-1 rounded-md px-2 transition-colors ${
                      activeSessionId === session.sessionId
                        ? 'bg-muted'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(session.sessionId)}
                      aria-current={activeSessionId === session.sessionId}
                      className="min-w-0 flex-1 py-2 text-left"
                    >
                      <span className="block truncate text-sm font-medium">
                        {session.title || t('newChat')}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {formatRelativeTime(session.updatedAt, locale)}
                        </span>
                        <span aria-hidden>·</span>
                        <span>
                          {t('sessionTaskCount', {
                            count: String(session.taskCount),
                          })}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={t('deleteSession')}
                      title={t('deleteSession')}
                      onClick={() => setConfirmingId(session.sessionId)}
                      className="shrink-0 rounded-sm p-1.5 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
        </ul>
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {t('noSessions')}
          </p>
        )}
      </nav>
    </div>
  );
}
