'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import {
  useCreateTask,
  useDeleteImageGenerateSession,
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
import { MaskEditor } from '@/components/tools/image-generate/mask-editor';
import type {
  GenerationMessageGroup,
  GenerationMessageTask,
  ImageGenerateChatDraft,
} from '@/components/tools/image-generate/types';
import {
  INPAINT_PROMPT_PREFIX,
  resolveDraftSize,
  stripInpaintPromptPrefix,
} from '@/components/tools/image-generate/types';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { DialogTitle } from '@/components/ui/dialog';
import { getImageUploadMaxFileSize } from '@/lib/tools/image-limits';
import { randomUUID } from '@/lib/random-uuid';

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
    const rawPrompt = typeof config.prompt === 'string' ? config.prompt : '';
    const mode =
      config.mode === 'image_to_image' || config.mode === 'inpaint'
        ? config.mode
        : 'text_to_image';
    // inpaint 的 prompt 带固定前缀(发给上游用的),气泡里只显示用户输入的部分。
    const prompt = stripInpaintPromptPrefix(rawPrompt, mode);
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
        referenceFileIds:
          mode === 'text_to_image' ? [] : (task.inputFileIds as string[]),
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
  const [newSessionId, setNewSessionId] = useState(() => randomUUID());
  const [activeSessionId, setActiveSessionId] = useState(newSessionId);
  const [draft, setDraft] = useState<ImageGenerateChatDraft>(INITIAL_DRAFT);
  // 参考图数组:0 张文生图、1 张图生图、多张融合。
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ key: string; code?: string } | null>(
    null
  );
  // 乐观消息:从提交开始显示,直到服务端数据里出现同 clientGroupId 的组。
  const [optimistic, setOptimistic] = useState<GenerationMessageGroup | null>(
    null
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // 局部重绘:正在编辑的结果图 blob url(null = 编辑器关闭)。
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
  const [inpaintBusy, setInpaintBusy] = useState(false);

  const output = useTaskOutputPreviews();
  // 已发起产物下载的 taskId:切会话后 previews 被清空,这个集合也要跟着重置。
  const loadedRef = useRef<Set<string>>(new Set());

  const providers = providersQuery.data ?? [];
  const selectedProvider =
    providers.find(item => item.id === draft.providerId) ?? providers[0];
  const editSupported =
    !selectedProvider || selectedProvider.capabilities.includes('edit');
  // 局部重绘依赖来源的 mask 传输能力(wan 系网关没有,kmage 的 gpt-image-2 有):
  // 入口始终展示,不支持的来源点击时给「换来源」引导,而不是让功能凭空消失。
  const inpaintSupported =
    !selectedProvider || selectedProvider.capabilities.includes('inpaint');

  /** 编辑入口统一走这里:支持的来源打开编辑器,不支持的给切换引导。 */
  const handleEditImage = (url: string) => {
    if (inpaintSupported) {
      setEditingImageUrl(url);
    } else {
      setFailure({ key: 'providerNoInpaintHint' });
    }
  };

  // 新会话在服务端没有任务,query 返回空列表,与「未启用」效果一致,无需额外门控。
  const sessionTasksQuery = useImageGenerateSessionTasks(activeSessionId);
  const sessionTasks = useMemo(
    () => sessionTasksQuery.data?.tasks ?? [],
    [sessionTasksQuery.data?.tasks]
  );

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

  // 生图失败返还额度:后端计数排除 failed(countTasksCreatedToday 的
  // ne(status,'failed')),任务转失败后当日已用自动回退;但额度快照只在建任务
  // 时刷新 —— 这里观察到新失败就失效额度查询,「今日剩余」立即回涨,
  // 而不是等下次进页面才对上账。
  const failedSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let hasNewFailure = false;
    for (const group of messageGroups) {
      for (const task of group.tasks ?? []) {
        if (
          task.status === 'failed' &&
          !failedSeenRef.current.has(task.taskId)
        ) {
          failedSeenRef.current.add(task.taskId);
          hasNewFailure = true;
        }
      }
    }
    if (hasNewFailure) {
      void queryClient.invalidateQueries({
        queryKey: taskQueryKeys.imageGenerateQuota(),
      });
    }
  }, [messageGroups, queryClient]);

  const startNewChat = () => {
    const id = randomUUID();
    setNewSessionId(id);
    setActiveSessionId(id);
    setReferenceFiles([]);
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

    const mode = referenceFiles.length > 0 ? 'image_to_image' : 'text_to_image';
    const clientGroupId = randomUUID();
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
      referenceFileIds: [],
      taskIds: [],
      // 数量占位:服务端数据到达前,消息里先亮出 N 个脉动格子。
      tasks: Array.from({ length: draft.count }, (_, index) => ({
        taskId: `${clientGroupId}-optimistic-${index}`,
        status: 'pending' as const,
      })),
    });

    // 参考图各上传一次,N 个任务共用同一组 fileId:同一批图重复上传既费额度也费带宽。
    let inputFileIds: string[] = [];
    if (mode === 'image_to_image' && referenceFiles.length > 0) {
      try {
        // upload 走 multipart,OpenAPI 里 201 没有 JSON content schema,openapi-fetch
        // 把返回类型推成 undefined,这里先转 unknown 再断言,与 use-files 里同一处理方式。
        const uploadedIds: string[] = [];
        for (const file of referenceFiles) {
          const uploaded = (await uploadFile.mutateAsync(file)) as unknown as {
            id: string;
          };
          uploadedIds.push(uploaded.id);
        }
        inputFileIds = uploadedIds;
        setOptimistic(current =>
          current && current.clientGroupId === clientGroupId
            ? { ...current, referenceFileIds: uploadedIds }
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
    let createdCount = 0;

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
        createdCount += 1;
      } catch (error) {
        // 部分超额不整批回滚:已建出的任务继续跑,剩下的报错。
        failureCode = errorCodeOf(error);
        break;
      }
    }

    // 至少建出一个任务就算"发出去了":清空输入框与参考图,用户专注看结果流。
    // 一张都没建出来(配额耗尽、来源不可用)时保留原输入,改完直接重发。
    if (createdCount > 0) {
      setDraft(current => ({ ...current, prompt: '' }));
      setReferenceFiles([]);
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

  /**
   * 局部重绘提交:编辑器产出的蒙版 + 原图一起上传,作为同会话里的新消息。
   *
   * 尺寸取原图的原始宽高(蒙版与原图逐像素对齐,输出尺寸也跟随原图);
   * 不在来源支持列表时回落到第一档,与普通提交同一条解析路径。
   */
  const submitInpaint = async ({
    maskBlob,
    markedBlob,
    prompt,
    width,
    height,
  }: {
    maskBlob: Blob;
    markedBlob: Blob;
    prompt: string;
    width: number;
    height: number;
  }) => {
    if (requireLogin(TOOL_HREF) || !editingImageUrl) return;

    const clientGroupId = randomUUID();
    // inputConfig.prompt 存用户原文:后端默认走官方 mask 通道(无需前缀),
    // 网关拒绝 mask 时才回退红标记通道并自行拼固定前缀。
    setFailure(null);
    setInpaintBusy(true);
    setOptimistic({
      clientGroupId,
      prompt,
      mode: 'inpaint',
      referenceFileIds: [],
      taskIds: [],
      tasks: [{ taskId: `${clientGroupId}-optimistic-0`, status: 'pending' }],
    });

    try {
      // 原图从 blob url 取回(展示用的就是原始产物,无需再加工)。
      const imageResponse = await fetch(editingImageUrl);
      if (!imageResponse.ok) throw new Error('fetch failed');
      const imageBlob = await imageResponse.blob();
      const baseFile = new File([imageBlob], 'inpaint-base.png', {
        type: imageBlob.type || 'image/png',
      });
      const maskFile = new File([maskBlob], 'inpaint-mask.png', {
        type: 'image/png',
      });
      const markedFile = new File([markedBlob], 'inpaint-marked.png', {
        type: 'image/png',
      });

      // 上传顺序即语义顺序:inputFileIds = [原图, 透明蒙版, 红标记图],
      // 后端先走官方 mask 通道,被拒时用红标记图回退。
      const baseUploaded = (await uploadFile.mutateAsync(
        baseFile
      )) as unknown as { id: string };
      const maskUploaded = (await uploadFile.mutateAsync(
        maskFile
      )) as unknown as { id: string };
      const markedUploaded = (await uploadFile.mutateAsync(
        markedFile
      )) as unknown as { id: string };

      setOptimistic(current =>
        current && current.clientGroupId === clientGroupId
          ? { ...current, referenceFileIds: [baseUploaded.id] }
          : current
      );

      const requestedSize = `${width}x${height}`;
      const size = resolveDraftSize(requestedSize, selectedProvider?.sizes);

      await createTask.mutateAsync({
        type: 'image_generate',
        inputFileIds: [baseUploaded.id, maskUploaded.id, markedUploaded.id],
        inputConfig: {
          mode: 'inpaint',
          prompt,
          size,
          quality: draft.quality,
          ...(draft.background ? { background: draft.background } : {}),
          ...(draft.providerId ? { providerId: draft.providerId } : {}),
          sessionId: activeSessionId,
          clientGroupId,
        },
      });
      setEditingImageUrl(null);
    } catch (error) {
      setFailure({
        key: SUBMIT_ERROR_KEYS[errorCodeOf(error)] ?? 'uploadFailed',
        code: errorCodeOf(error),
      });
      setOptimistic(null);
    } finally {
      setInpaintBusy(false);
      await queryClient.invalidateQueries({
        queryKey: taskQueryKeys.imageGenerateSessions(),
      });
    }
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
  const busy = submitting || inFlight || fetchingResults || inpaintBusy;

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

  const deleteSession = useDeleteImageGenerateSession();
  const handleDeleteSession = (sessionId: string) => {
    void deleteSession.mutate(sessionId, {
      onSuccess: () => {
        // 删的是当前会话:画布切回新对话,预览与加载记录一并清空。
        if (sessionId === activeSessionId) {
          startNewChat();
        } else {
          output.reset();
          loadedRef.current = new Set();
        }
      },
      onError: error => {
        const code = (error as { code?: unknown })?.code;
        setFailure(
          code === 'SESSION_HAS_ACTIVE_TASKS'
            ? { key: 'sessionHasActiveTasks' }
            : { key: 'failed' }
        );
      },
    });
  };

  const sidebar = (
    <ConversationSidebar
      sessions={sessionsQuery.data ?? []}
      newSessionId={newSessionId}
      activeSessionId={activeSessionId}
      onSelect={selectSession}
      onNew={startNewChat}
      onDelete={handleDeleteSession}
      deletingSessionId={
        deleteSession.isPending ? deleteSession.variables : null
      }
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
            onEditImage={handleEditImage}
            user={session?.user}
          />
        ))}
        {failure && <SystemNotice message={t(failure.key)} onRetry={submit} />}
        {sessionTasksQuery.isError && <SystemNotice message={t('failed')} />}
      </>
    );

  return (
    // 负 margin 吃掉 (app) main 的 padding;高度取「视口 − header(3.5rem) − main 上下 padding」:
    // 必须是确定高度而不是 flex-1 自适应 —— 否则内容(长消息流/会话列表)会把整页撑高,
    // 浏览器窗口滚动条出现,会话列表跟着内容区一起滚(两者都被窗口滚动带着走)。
    <div className="-m-4 flex h-[calc(100dvh-3.5rem-2rem)] overflow-hidden lg:-m-6 lg:h-[calc(100dvh-3.5rem-3rem)]">
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
          <MessageCanvas messageCount={messageGroups.length}>
            {canvas}
          </MessageCanvas>
        </div>

        <div className="shrink-0 p-3 lg:p-4">
          <div className="mx-auto max-w-3xl">
            <PromptComposer
              draft={draft}
              onDraftChange={setDraft}
              referenceFiles={referenceFiles}
              onReferenceChange={setReferenceFiles}
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

      {/* 局部重绘蒙版编辑器。 */}
      <MaskEditor
        open={Boolean(editingImageUrl)}
        imageUrl={editingImageUrl ?? ''}
        onClose={() => setEditingImageUrl(null)}
        onSubmit={payload => void submitInpaint(payload)}
        busy={inpaintBusy}
      />

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
