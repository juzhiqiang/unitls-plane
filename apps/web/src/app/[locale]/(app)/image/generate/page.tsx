'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import {
  useCreateTask,
  useDeleteImageGenerateSession,
  useImageGeneratePresets,
  useImageGenerateModels,
  useImageGenerateQuota,
  useImageGenerateSessions,
  useImageGenerateSessionTasks,
} from '@/hooks/api/use-tasks';
import { useUploadFile } from '@/hooks/api/use-files';
import { buildFileDownloadUrl } from '@/lib/files/file-download';
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
  AI_IMAGE_PROVIDER_UNAVAILABLE: 'modelUnavailable',
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

function taskConfigOf(task: TaskResponseDto): {
  prompt?: unknown;
  mode?: unknown;
  clientGroupId?: unknown;
  retriedFrom?: unknown;
} {
  return (task.inputConfig ?? {}) as {
    prompt?: unknown;
    mode?: unknown;
    clientGroupId?: unknown;
    retriedFrom?: unknown;
  };
}

/**
 * 服务端任务列表 → 消息组:一次提交(clientGroupId)聚成一条消息。
 *
 * 「重新生成」在服务端会新建一个带 `retriedFrom=父任务id` 的任务(见 retry 控制器)。
 * 这里把这类子任务沿血缘链折叠回**被点击的那张格子**:每个槽位只保留链首(根)任务,
 * 展示时解析到链尾(最新一次尝试)的状态与产物 —— 失败 → 生成中 → 出图都在原地发生,
 * 旁边不再多出一个新格子。
 */
function toMessageGroups(tasks: TaskResponseDto[]): GenerationMessageGroup[] {
  // 父任务 id → 重试出来的子任务(取最后一个,链尾即最新一次尝试)。
  const replacedBy = new Map<string, TaskResponseDto>();
  for (const task of tasks) {
    const retriedFrom = taskConfigOf(task).retriedFrom;
    if (typeof retriedFrom === 'string') {
      replacedBy.set(retriedFrom, task);
    }
  }

  // 沿血缘链走到链尾:最新一次重试的任务(用它的状态/产物展示)。
  const resolveTip = (task: TaskResponseDto): TaskResponseDto => {
    let tip = task;
    const seen = new Set<string>([task.id]);
    let next = replacedBy.get(tip.id);
    while (next && !seen.has(next.id)) {
      seen.add(next.id);
      tip = next;
      next = replacedBy.get(tip.id);
    }
    return tip;
  };

  const groups = new Map<string, GenerationMessageGroup>();
  for (const task of tasks) {
    const config = taskConfigOf(task);
    // 本身是「被重试出来的子任务」:它会通过父任务的槽位显示,不单独占格子。
    if (typeof config.retriedFrom === 'string') continue;

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
    // 解析到链尾:格子展示的是最新一次尝试的状态与产物。
    const tip = resolveTip(task);
    const entry: GenerationMessageTask = {
      taskId: tip.id,
      status: tip.status,
      progress: tip.progress,
      outputFileId: tip.outputFileId,
      errorCode: tip.errorCode,
      errorMessage: tip.errorMessage,
    };

    const existing = groups.get(clientGroupId);
    if (existing) {
      existing.taskIds.push(tip.id);
      existing.tasks?.push(entry);
    } else {
      groups.set(clientGroupId, {
        clientGroupId,
        prompt,
        mode,
        referenceFileIds:
          mode === 'text_to_image' ? [] : (task.inputFileIds as string[]),
        taskIds: [tip.id],
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
  const modelsQuery = useImageGenerateModels();
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
  // MaskEditor 要把图 drawImage 进 canvas 再 toBlob 导出蒙版,跨域图会污染 canvas,
  // 所以这里存的是「按需 fetch 原图转出的同源 objectURL」,而不是跨域 /download URL。
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
  const [inpaintBusy, setInpaintBusy] = useState(false);
  // 当前编辑用的 objectURL,切换/关闭时回收,避免泄漏。
  const editingObjectUrlRef = useRef<string | null>(null);

  const models = modelsQuery.data ?? [];
  const selectedModel =
    models.find(item => item.model === draft.model) ?? models[0];
  const editSupported =
    !selectedModel || selectedModel.capabilities.includes('edit');
  // 局部重绘依赖模型的 mask 传输能力(wan 系网关没有,kmage 的 gpt-image-2 有):
  // 入口始终展示,不支持的模型点击时给「换模型」引导,而不是让功能凭空消失。
  const inpaintSupported =
    !selectedModel || selectedModel.capabilities.includes('inpaint');

  // 回收上一张编辑用的 objectURL(切换编辑对象、关闭编辑器时调用)。
  const revokeEditingObjectUrl = () => {
    if (editingObjectUrlRef.current) {
      URL.revokeObjectURL(editingObjectUrlRef.current);
      editingObjectUrlRef.current = null;
    }
  };

  const closeEditor = () => {
    revokeEditingObjectUrl();
    setEditingImageUrl(null);
  };

  useEffect(() => () => revokeEditingObjectUrl(), []);

  /**
   * 编辑入口统一走这里:模型支持整图改图(edit)或圈选重绘(inpaint)任一即可开编辑器,
   * 编辑器内部按 inpaintSupported 决定是否给圈选工具;两者都不支持才给切换引导。
   *
   * 网格只加载缩略图,编辑要的是原图:这里按 fileId 拉一次原图转成同源 objectURL 再交给
   * 编辑器 —— 既保证 canvas 不被跨域图污染(toBlob 可用),也让蒙版按原图尺寸对齐。
   */
  const handleEditImage = async (fileId: string) => {
    if (!editSupported && !inpaintSupported) {
      setFailure({ key: 'modelNoEditHint' });
      return;
    }
    try {
      const response = await fetch(buildFileDownloadUrl(fileId), {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('fetch failed');
      const objectUrl = URL.createObjectURL(await response.blob());
      revokeEditingObjectUrl();
      editingObjectUrlRef.current = objectUrl;
      setEditingImageUrl(objectUrl);
    } catch {
      setFailure({ key: 'failed' });
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

  // 结果图不再预取 blob:网格用缩略图端点 + 原生 <img loading="lazy">,由浏览器按
  // 视口懒加载、按 HTTP 缓存复用。切会话不再瞬间并发几十个原图下载(旧的两个 effect
  // ——切会话 reset 预览、遍历 completed 并发 load —— 已删除)。

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
    // 草稿尺寸(默认 auto)不在当前模型支持列表时回落到第一档,免得提交一个
    // 会在 processor 被尺寸交叉校验拒掉的值。
    const size = resolveDraftSize(draft.size, selectedModel?.sizes);

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
            ...(draft.model ? { model: draft.model } : {}),
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
   * 编辑器提交:圈选可选,按有无蒙版分两条链路,都作为同会话里的新消息。
   *
   * - 有蒙版(圈了区域)→ inpaint:上传 [原图, 透明蒙版, 红标记图],后端先走官方
   *   mask 通道,被拒时用红标记图回退。
   * - 无蒙版(只写描述)→ image_to_image:只上传原图当唯一参考图,整图按描述改图。
   *
   * 尺寸取原图的原始宽高(蒙版与原图逐像素对齐,输出尺寸也跟随原图);不在来源支持
   * 列表时回落到第一档,与普通提交同一条解析路径。
   */
  const submitEdit = async ({
    maskBlob,
    markedBlob,
    prompt,
    width,
    height,
  }: {
    maskBlob?: Blob;
    markedBlob?: Blob;
    prompt: string;
    width: number;
    height: number;
  }) => {
    if (requireLogin(TOOL_HREF) || !editingImageUrl) return;

    const isInpaint = Boolean(maskBlob && markedBlob);
    const mode = isInpaint ? 'inpaint' : 'image_to_image';
    const clientGroupId = randomUUID();
    // inputConfig.prompt 存用户原文:inpaint 时后端默认走官方 mask 通道(无需前缀),
    // 网关拒绝 mask 时才回退红标记通道并自行拼固定前缀;image_to_image 直接用原文。
    setFailure(null);
    setInpaintBusy(true);
    setOptimistic({
      clientGroupId,
      prompt,
      mode,
      referenceFileIds: [],
      taskIds: [],
      tasks: [{ taskId: `${clientGroupId}-optimistic-0`, status: 'pending' }],
    });

    try {
      // 原图从 blob url 取回(展示用的就是原始产物,无需再加工)。
      const imageResponse = await fetch(editingImageUrl);
      if (!imageResponse.ok) throw new Error('fetch failed');
      const imageBlob = await imageResponse.blob();
      const baseFile = new File([imageBlob], 'edit-base.png', {
        type: imageBlob.type || 'image/png',
      });

      // 原图两条链路都要:image_to_image 的唯一参考图,或 inpaint 的第一张。
      const baseUploaded = (await uploadFile.mutateAsync(
        baseFile
      )) as unknown as { id: string };

      let inputFileIds = [baseUploaded.id];
      if (isInpaint) {
        const maskFile = new File([maskBlob!], 'inpaint-mask.png', {
          type: 'image/png',
        });
        const markedFile = new File([markedBlob!], 'inpaint-marked.png', {
          type: 'image/png',
        });
        // 上传顺序即语义顺序:inputFileIds = [原图, 透明蒙版, 红标记图]。
        const maskUploaded = (await uploadFile.mutateAsync(
          maskFile
        )) as unknown as { id: string };
        const markedUploaded = (await uploadFile.mutateAsync(
          markedFile
        )) as unknown as { id: string };
        inputFileIds = [baseUploaded.id, maskUploaded.id, markedUploaded.id];
      }

      setOptimistic(current =>
        current && current.clientGroupId === clientGroupId
          ? { ...current, referenceFileIds: [baseUploaded.id] }
          : current
      );

      const requestedSize = `${width}x${height}`;
      const size = resolveDraftSize(requestedSize, selectedModel?.sizes);

      await createTask.mutateAsync({
        type: 'image_generate',
        inputFileIds,
        inputConfig: {
          mode,
          prompt,
          size,
          quality: draft.quality,
          ...(draft.background ? { background: draft.background } : {}),
          ...(draft.model ? { model: draft.model } : {}),
          sessionId: activeSessionId,
          clientGroupId,
        },
      });
      revokeEditingObjectUrl();
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
  // 任务 completed 即解除忙碌态:结果图交给缩略图 <img> 懒加载,不再按住到 blob 下完
  // (旧写法会先下完 blob 才恢复按钮;现在出图即可继续操作,图片就地懒加载显示)。
  const busy = submitting || inFlight || inpaintBusy;

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
        // 删的是当前会话:画布切回新对话。删其它会话时当前画布不受影响,
        // 结果图由缩略图 <img> 各自加载,无预取状态需要清理。
        if (sessionId === activeSessionId) {
          startNewChat();
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
            onEditImage={fileId => void handleEditImage(fileId)}
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
              models={models}
              quota={session ? quota.data : undefined}
              editSupported={editSupported}
              maxReferenceSize={getImageUploadMaxFileSize(session)}
            />
          </div>
        </div>
      </div>

      {/* 图片编辑器:圈选可选。支持 inpaint 才给圈选工具,否则纯描述整图改图。 */}
      <MaskEditor
        open={Boolean(editingImageUrl)}
        imageUrl={editingImageUrl ?? ''}
        inpaintSupported={inpaintSupported}
        onClose={closeEditor}
        onSubmit={payload => void submitEdit(payload)}
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
