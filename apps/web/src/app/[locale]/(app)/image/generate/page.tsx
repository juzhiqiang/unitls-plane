'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import {
  useCreateTask,
  useImageGeneratePresets,
  useImageGenerateProviders,
  useImageGenerateQuota,
  useImageGenerateSessions,
  useImageGenerateSessionTasks,
} from '@/hooks/api/use-tasks';
import { useUploadFile } from '@/hooks/api/use-files';
import { useTaskOutputPreviews } from '@/hooks/api/use-task-output';
import { useRequireLogin } from '@/hooks/use-require-login';
import { taskQueryKeys } from '@/hooks/api/query-keys';
import type { TaskResponseDto } from '@/hooks/api/types';
import { ConversationSidebar } from '@/components/tools/image-generate/conversation-sidebar';
import { MessageCanvas } from '@/components/tools/image-generate/message-canvas';
import {
  GenerationMessage,
  SystemNotice,
} from '@/components/tools/image-generate/generation-message';
import { PromptComposer } from '@/components/tools/image-generate/prompt-composer';
import { EmptyState } from '@/components/tools/image-generate/empty-state';
import type {
  GenerationMessageGroup,
  GenerationMessageTask,
  ImageGenerateChatDraft,
} from '@/components/tools/image-generate/types';
import { resolveDraftSize } from '@/components/tools/image-generate/types';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { DialogTitle } from '@/components/ui/dialog';
import { getImageUploadMaxFileSize } from '@/lib/tools/image-limits';

const TOOL_HREF = '/image/generate';

/** batch 级(提交/建任务阶段)错误的文案映射,与消息内联展示共用语义。 */
const SUBMIT_ERROR_KEYS: Record<string, string> = {
  AI_IMAGE_DAILY_LIMIT_EXCEEDED: 'quotaExceeded',
  AI_IMAGE_CONTENT_REJECTED: 'contentRejected',
  AI_IMAGE_NOT_CONFIGURED: 'notConfigured',
  AI_IMAGE_PROVIDER_UNAVAILABLE: 'providerUnavailable',
};

const INITIAL_DRAFT: ImageGenerateChatDraft = {
  prompt: '',
  size: 'auto',
  quality: 'auto',
  count: 1,
};

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'AI_IMAGE_GENERATION_FAILED';
}

/** 服务端任务列表 → 消息组:一次提交(clientGroupId)聚成一条消息。 */
function toMessageGroups(tasks: TaskResponseDto[]): GenerationMessageGroup[] {
  const groups = new Map<string, GenerationMessageGroup>();
  for (const task of tasks) {
    const config = (task.inputConfig ?? {}) as {
      prompt?: unknown;
      mode?: unknown;
      clientGroupId?: unknown;
    };
    // 旧客户端的任务没有 clientGroupId,单任务自成一组。
    const clientGroupId =
      typeof config.clientGroupId === 'string' ? config.clientGroupId : task.id;
    const prompt = typeof config.prompt === 'string' ? config.prompt : '';
    const mode =
      config.mode === 'image_to_image' ? 'image_to_image' : 'text_to_image';
    const entry: GenerationMessageTask = {
      taskId: task.id,
      status: task.status,
      progress: task.progress,
      outputFileId: task.outputFileId,
      errorCode: task.errorCode,
    };

    const existing = groups.get(clientGroupId);
    if (existing) {
      existing.taskIds.push(task.id);
      existing.tasks?.push(entry);
    } else {
      groups.set(clientGroupId, {
        clientGroupId,
        prompt,
        mode,
        referenceFileId:
          mode === 'image_to_image' ? task.inputFileIds[0] : undefined,
        taskIds: [task.id],
        tasks: [entry],
      });
    }
  }
  return Array.from(groups.values());
}

export default function ImageGeneratePage() {
  const t = useTranslations('ImageGenerate');
  const queryClient = useQueryClient();
  const { session, requireLogin } = useRequireLogin();
  const createTask = useCreateTask();
  const quota = useImageGenerateQuota();
  const providersQuery = useImageGenerateProviders();
  const presetsQuery = useImageGeneratePresets();
  const sessionsQuery = useImageGenerateSessions();
  const uploadFile = useUploadFile();

  // 会话:新对话在本地生成 uuid,提交首个任务后才出现在服务端列表里。
  const [newSessionId, setNewSessionId] = useState(() =>
    globalThis.crypto.randomUUID()
  );
  const [activeSessionId, setActiveSessionId] = useState(newSessionId);
  const [draft, setDraft] = useState<ImageGenerateChatDraft>(INITIAL_DRAFT);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ key: string; code?: string } | null>(
    null
  );
  // 乐观消息:从提交开始显示,直到服务端数据里出现同 clientGroupId 的组。
  const [optimistic, setOptimistic] = useState<GenerationMessageGroup | null>(
    null
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const output = useTaskOutputPreviews();
  // 已发起产物下载的 taskId:切会话后 previews 被清空,这个集合也要跟着重置。
  const loadedRef = useRef<Set<string>>(new Set());

  const providers = providersQuery.data ?? [];
  const selectedProvider =
    providers.find(item => item.id === draft.providerId) ?? providers[0];
  const editSupported =
    !selectedProvider || selectedProvider.capabilities.includes('edit');

  // 新会话在服务端没有任务,query 返回空列表,与「未启用」效果一致,无需额外门控。
  const sessionTasksQuery = useImageGenerateSessionTasks(activeSessionId);
  const sessionTasks = sessionTasksQuery.data?.tasks ?? [];

  const messageGroups = useMemo(() => {
    const serverGroups = toMessageGroups(sessionTasks);
    // 乐观组只在服务端还没有它的期间显示(提交中或刷新间隙),避免消息闪没。
    if (
      optimistic &&
      !serverGroups.some(
        group => group.clientGroupId === optimistic.clientGroupId
      )
    ) {
      return [...serverGroups, optimistic];
    }
    return serverGroups;
  }, [sessionTasks, optimistic]);

  // 切会话:清空预览与已加载集合,恢复历史会话时 completed 任务会经 effect 重新取回。
  useEffect(() => {
    output.reset();
    loadedRef.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // completed 任务统一在这里取回产物(新完成的与历史恢复的走同一条路)。
  useEffect(() => {
    for (const group of messageGroups) {
      for (const task of group.tasks ?? []) {
        if (
          task.status === 'completed' &&
          task.outputFileId &&
          !loadedRef.current.has(task.taskId)
        ) {
          loadedRef.current.add(task.taskId);
          void output.load(task.taskId, task.outputFileId);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageGroups]);

  const startNewChat = () => {
    const id = globalThis.crypto.randomUUID();
    setNewSessionId(id);
    setActiveSessionId(id);
    setReferenceFile(null);
    setFailure(null);
    setOptimistic(null);
    setMobileSidebarOpen(false);
  };

  const selectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setFailure(null);
    setOptimistic(null);
    setMobileSidebarOpen(false);
  };

  const submit = async () => {
    if (requireLogin(TOOL_HREF)) return;

    const mode = referenceFile ? 'image_to_image' : 'text_to_image';
    const clientGroupId = globalThis.crypto.randomUUID();
    const prompt = draft.prompt.trim();
    // 草稿尺寸(默认 auto)不在当前来源支持列表时回落到第一档,免得提交一个
    // 会在 processor 被尺寸交叉校验拒掉的值。
    const size = resolveDraftSize(draft.size, selectedProvider?.sizes);

    setFailure(null);
    setSubmitting(true);
    setOptimistic({
      clientGroupId,
      prompt,
      mode,
      taskIds: [],
      // 数量占位:服务端数据到达前,消息里先亮出 N 个脉动格子。
      tasks: Array.from({ length: draft.count }, (_, index) => ({
        taskId: `${clientGroupId}-optimistic-${index}`,
        status: 'pending' as const,
      })),
    });

    // 参考图只上传一次,N 个任务共用同一个 fileId:同一张图重复上传既费额度也费带宽。
    let inputFileIds: string[] = [];
    if (mode === 'image_to_image' && referenceFile) {
      try {
        // upload 走 multipart,OpenAPI 里 201 没有 JSON content schema,openapi-fetch
        // 把返回类型推成 undefined,这里先转 unknown 再断言,与 use-files 里同一处理方式。
        const uploaded = (await uploadFile.mutateAsync(
          referenceFile
        )) as unknown as { id: string };
        inputFileIds = [uploaded.id];
        setOptimistic(current =>
          current && current.clientGroupId === clientGroupId
            ? { ...current, referenceFileId: uploaded.id }
            : current
        );
      } catch {
        setFailure({ key: 'uploadFailed' });
        setSubmitting(false);
        setOptimistic(null);
        return;
      }
    }

    let failureCode: string | null = null;

    // 串行(而非 Promise.all)创建:createTask 只是入队(廉价 insert),真正生成在
    // worker 并发跑,N 张只多几次入队往返。串行才能让配额判定确定 —— 每次都看到
    // 前一次扣减后的计数,第一个 AI_IMAGE_DAILY_LIMIT_EXCEEDED 能干净地 break。
    // Promise.all 无法 break 且会与配额记账竞态,切勿"优化"成并发。
    for (let index = 0; index < draft.count; index += 1) {
      try {
        await createTask.mutateAsync({
          type: 'image_generate',
          inputFileIds,
          inputConfig: {
            mode,
            prompt,
            size,
            quality: draft.quality,
            ...(draft.background ? { background: draft.background } : {}),
            ...(draft.providerId ? { providerId: draft.providerId } : {}),
            sessionId: activeSessionId,
            clientGroupId,
          },
        });
      } catch (error) {
        // 部分超额不整批回滚:已建出的任务继续跑,剩下的报错。
        failureCode = errorCodeOf(error);
        break;
      }
    }

    setFailure(
      failureCode
        ? {
            key: SUBMIT_ERROR_KEYS[failureCode] ?? 'failed',
            code: failureCode,
          }
        : null
    );
    setSubmitting(false);
    // 服务端会话列表刷新后,当前会话的任务 query 随之更新(会话任务 key 是它的前缀)。
    await queryClient.invalidateQueries({
      queryKey: taskQueryKeys.imageGenerateSessions(),
    });
  };

  const inFlight = messageGroups.some(group =>
    (group.tasks ?? []).some(
      task => task.status === 'pending' || task.status === 'processing'
    )
  );
  // 任务 settled 只说明服务端出图了,页面还要再下载一次 blob 才有东西可看:
  // busy 要按住到图片真的能显示,否则按钮先恢复、格子空着、图片随后突然出现。
  const fetchingResults = messageGroups.some(group =>
    (group.tasks ?? []).some(
      task =>
        task.status === 'completed' &&
        (output.previews[task.taskId]?.state ?? 'loading') === 'loading'
    )
  );
  const busy = submitting || inFlight || fetchingResults;

  const activeSessionTitle =
    activeSessionId === newSessionId
      ? t('newChat')
      : (sessionsQuery.data ?? []).find(
          item => item.sessionId === activeSessionId
        )?.title || t('title');

  const pickPreset = (prompt: string) => {
    setDraft(current => ({ ...current, prompt }));
    document.getElementById('image-generate-prompt')?.focus();
  };

  const sidebar = (
    <ConversationSidebar
      sessions={sessionsQuery.data ?? []}
      newSessionId={newSessionId}
      activeSessionId={activeSessionId}
      onSelect={selectSession}
      onNew={startNewChat}
    />
  );

  const canvas =
    messageGroups.length === 0 && !failure && !sessionTasksQuery.isError ? (
      <EmptyState
        presets={presetsQuery.data ?? []}
        disabled={busy}
        onPick={pickPreset}
      />
    ) : (
      <>
        {messageGroups.map(group => (
          <GenerationMessage
            key={group.clientGroupId}
            group={group}
            previews={output.previews}
            onRetryFetch={(taskId, outputFileId) =>
              void output.load(taskId, outputFileId)
            }
          />
        ))}
        {failure && <SystemNotice message={t(failure.key)} onRetry={submit} />}
        {sessionTasksQuery.isError && <SystemNotice message={t('failed')} />}
      </>
    );

  return (
    // 负 margin 吃掉 (app) main 的 padding:对话页需要贴边的全高布局。
    <div className="-m-4 flex min-h-0 flex-1 overflow-hidden lg:-m-6">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border lg:flex">
        {sidebar}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 移动端顶条:打开会话侧栏。 */}
        <div className="flex items-center gap-2 border-b border-border p-2 lg:hidden">
          <button
            type="button"
            aria-label={t('sidebarTitle')}
            onClick={() => setMobileSidebarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <History className="h-4 w-4" />
          </button>
          <span className="truncate text-sm font-medium">
            {activeSessionTitle}
          </span>
        </div>

        <div className="min-h-0 flex-1">
          <MessageCanvas>{canvas}</MessageCanvas>
        </div>

        <div className="shrink-0 p-3 lg:p-4">
          <div className="mx-auto max-w-3xl">
            <PromptComposer
              draft={draft}
              onDraftChange={setDraft}
              referenceFile={referenceFile}
              onReferenceChange={setReferenceFile}
              onSubmit={submit}
              busy={busy}
              providers={providers}
              quota={session ? quota.data : undefined}
              editSupported={editSupported}
              maxReferenceSize={getImageUploadMaxFileSize(session)}
            />
          </div>
        </div>
      </div>

      {/* 移动端会话侧栏。DialogTitle 是 Radix 的无障碍要求(DialogContent 必须有标题)。 */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent
          side="left"
          className="w-72 border-r p-0"
          aria-label={t('sidebarTitle')}
        >
          <DialogTitle className="sr-only">{t('sidebarTitle')}</DialogTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
    </div>
  );
}
