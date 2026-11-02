'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useRequireLogin } from '@/hooks/use-require-login';
import { useTaskStatus, useImageGenerateQuota, useImageGenerateModels } from '@/hooks/api/use-tasks';
import { useAiTryOnReferences } from '@/hooks/api/use-ai-try-on';
import { buildImageTryOnTaskPayload, type BuildImageTryOnPayloadInput } from '@/components/tools/ai-try-on';
import { PoseLibraryWithFilters, UploadReferenceCard, CategoryFilteredLibraryGrid } from '@/components/tools/ai-try-on';
import { api } from '@/lib/api-client';
import { toast } from 'sonner';
import { Loader2, Download, RefreshCw, FileText, Image as ImageIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

type AiTryOnMode = 'product' | 'inspiration';
type PersonSourceType = 'upload' | 'library';

// 获取文件下载URL
function getFileDownloadUrl(fileId: string): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  return `${apiBase}/files/${fileId}/download`;
}

// 计算任务进度百分比
function calculateProgress(status: string): number {
  switch (status) {
    case 'pending': return 10;
    case 'processing': return 50;
    case 'completed': return 100;
    case 'failed': return 0;
    default: return 0;
  }
}

// 获取预计剩余时间文本
function getEstimatedTimeText(status: string, t: any): string {
  switch (status) {
    case 'pending': return t('estimatedTime.pending');
    case 'processing': return t('estimatedTime.processing');
    default: return '';
  }
}

export default function AiTryOnPage() {
  const t = useTranslations('ImageTryOn');
  const locale = useLocale();
  const router = useRouter();
  useRequireLogin();

  // 基础状态
  const [mode, setMode] = useState<AiTryOnMode>('product');
  const [personSourceType, setPersonSourceType] = useState<PersonSourceType>('upload');
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [personAssetId, setPersonAssetId] = useState<string | null>(null);
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentAssetId, setGarmentAssetId] = useState<string | null>(null);
  const [poseAssetId, setPoseAssetId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState<'auto' | 'standard' | 'high'>('high');
  const [model, setModel] = useState<string>('');
  
  // 任务状态
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  // API hooks
  const { data: poseLibrary, isLoading: isPoseLoading } = useAiTryOnReferences('pose');
  const { data: garmentLibrary, isLoading: isGarmentLoading } = useAiTryOnReferences('garment');
  const { data: personLibrary, isLoading: isPersonLoading } = useAiTryOnReferences('person');
  const { data: taskStatus, refetch: refetchTaskStatus } = useTaskStatus(taskId ?? '');
  const { data: quota, refetch: refetchQuota } = useImageGenerateQuota();
  const { data: models } = useImageGenerateModels();

  // 轮询任务状态（优化点2：进度显示）
  useEffect(() => {
    if (!taskId || !taskStatus) return;
    
    if (taskStatus.status === 'pending' || taskStatus.status === 'processing') {
      const timer = setInterval(() => {
        refetchTaskStatus();
      }, 3000); // 每3秒轮询一次
      return () => clearInterval(timer);
    }

    // 任务完成后刷新额度
    if (taskStatus.status === 'completed') {
      refetchQuota();
    }
  }, [taskId, taskStatus, refetchTaskStatus, refetchQuota]);

  // 计算状态
  const quotaText = useMemo(() => {
    if (!quota) return t('quotaLoading');
    return t('quotaRemaining', { remaining: quota.remaining, limit: quota.limit });
  }, [quota, t]);

  const taskProgress = useMemo(() => {
    if (!taskStatus) return 0;
    return calculateProgress(taskStatus.status);
  }, [taskStatus]);

  const estimatedTimeText = useMemo(() => {
    if (!taskStatus) return '';
    return getEstimatedTimeText(taskStatus.status, t);
  }, [taskStatus, t]);

  const resultImageUrl = useMemo(() => {
    if (taskStatus?.status === 'completed' && taskStatus.outputFileId) {
      return getFileDownloadUrl(taskStatus.outputFileId);
    }
    return null;
  }, [taskStatus]);

  // 根据模式和人像来源类型判断是否可以提交
  const canSubmit = useMemo(() => {
    if (isSubmitting || (quota?.remaining ?? 0) <= 0) {
      return false;
    }

    // 人像必须选择
    const hasPersonReference = personSourceType === 'upload' 
      ? personFile !== null 
      : personAssetId !== null;
    
    if (!hasPersonReference) return false;

    // 服装必须选择
    if (mode === 'product') {
      return garmentFile !== null;
    } else {
      return garmentAssetId !== null;
    }
  }, [mode, personSourceType, personFile, personAssetId, garmentFile, garmentAssetId, isSubmitting, quota]);

  // 上传文件
  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);

    const { data, error } = await api.POST('/files/upload', {
      body: formData as any,
    });

    if (error || !data) {
      throw new Error('File upload failed');
    }

    return (data as any).id;
  }, []);

  // 提交试衣任务
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    if ((quota?.remaining ?? 0) <= 0) {
      toast.error(t('quotaExhausted'));
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(null);

    try {
      // 准备上传文件列表
      const filesToUpload: Array<{ file: File; role: 'person' | 'garment' }> = [];
      
      if (personSourceType === 'upload' && personFile) {
        filesToUpload.push({ file: personFile, role: 'person' });
      }
      
      if (mode === 'product' && garmentFile) {
        filesToUpload.push({ file: garmentFile, role: 'garment' });
      }

      // 上传文件
      setUploadProgress({ current: 0, total: filesToUpload.length });
      const fileIds: Record<string, string> = {};
      
      for (let i = 0; i < filesToUpload.length; i++) {
        const { file, role } = filesToUpload[i];
        const fileId = await uploadFile(file);
        fileIds[role] = fileId;
        setUploadProgress({ current: i + 1, total: filesToUpload.length });
      }

      // 构建任务配置
      const input: BuildImageTryOnPayloadInput = {
        mode,
        person: personSourceType === 'upload'
          ? { source: 'upload', fileId: fileIds.person }
          : { source: 'library', assetId: personAssetId! },
        garment: mode === 'product'
          ? { source: 'upload', fileId: fileIds.garment }
          : { source: 'library', assetId: garmentAssetId! },
        poseAssetId: poseAssetId ?? undefined,
        promptAddition: prompt.trim() || undefined,
        size,
        quality,
        model: model || undefined,
      };

      const payloadResult = buildImageTryOnTaskPayload(input);

      if (!payloadResult.ok) {
        throw new Error(t(`errors.${payloadResult.errorKey}` as any));
      }

      // 创建任务
      const { data, error } = await api.POST('/tasks', {
        body: payloadResult.payload as any,
      });

      if (error || !data) {
        throw new Error(t('errors.failed'));
      }

      setTaskId((data as any).id);
      toast.success(t('queued'));
    } catch (error) {
      console.error('Submit error:', error);
      toast.error((error as Error).message || t('errors.failed'));
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  }, [
    canSubmit, mode, personSourceType, personFile, personAssetId, garmentFile, garmentAssetId,
    poseAssetId, prompt, size, quality, model, quota, uploadFile, t
  ]);

  // 重新生成（优化点1：结果展示）
  const handleRegenerate = useCallback(() => {
    setTaskId(null);
    // 保留当前选择的参数，允许快速重新生成
  }, []);

  // 下载结果（优化点1：结果展示）
  const handleDownload = useCallback(() => {
    if (!resultImageUrl) return;
    window.open(resultImageUrl, '_blank');
  }, [resultImageUrl]);

  // 查看文件管理器
  const handleViewFiles = useCallback(() => {
    router.push(`/${locale}/files`);
  }, [router, locale]);

  return (
    <div className="container mx-auto max-w-7xl space-y-8 px-4 py-8">
      {/* 页头 */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">{t('quotaLabel')}:</span>
          <span className="font-medium">{quotaText}</span>
        </div>
      </div>

      {/* 模式选择 */}
      <div className="rounded-lg border border-border bg-card p-6">
        <label className="mb-3 block text-sm font-medium">{t('modeLabel')}</label>
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setMode('product')}
            disabled={isSubmitting}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              mode === 'product'
                ? 'border-foreground bg-foreground/5'
                : 'border-border hover:border-foreground/50'
            } disabled:opacity-50`}
          >
            <div className="font-semibold">{t('modes.product')}</div>
            <div className="mt-1 text-sm text-muted-foreground">{t('modes.productDesc')}</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('inspiration')}
            disabled={isSubmitting}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              mode === 'inspiration'
                ? 'border-foreground bg-foreground/5'
                : 'border-border hover:border-foreground/50'
            } disabled:opacity-50`}
          >
            <div className="font-semibold">{t('modes.inspiration')}</div>
            <div className="mt-1 text-sm text-muted-foreground">{t('modes.inspirationDesc')}</div>
          </button>
        </div>
      </div>

      {/* 参考图选择 */}
      <div className="space-y-6">
        {/* 1. 人像参考（优化点4：人像图库） */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">{t('personReferenceLabel')}</h3>
          
          {/* 人像来源选择 */}
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setPersonSourceType('upload')}
              disabled={isSubmitting}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                personSourceType === 'upload'
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              } disabled:opacity-50`}
            >
              {t('personSource.upload')}
            </button>
            {personLibrary && personLibrary.length > 0 && (
              <button
                type="button"
                onClick={() => setPersonSourceType('library')}
                disabled={isSubmitting}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  personSourceType === 'library'
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                } disabled:opacity-50`}
              >
                {t('personSource.library')}
              </button>
            )}
          </div>

          {personSourceType === 'upload' ? (
            <UploadReferenceCard
              file={personFile}
              onFileSelect={setPersonFile}
              label={t('uploadPersonLabel')}
              accept="image/*"
              disabled={isSubmitting}
            />
          ) : (
            <div>
              {isPersonLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : personLibrary && personLibrary.length > 0 ? (
                <CategoryFilteredLibraryGrid
                  items={personLibrary}
                  selectedId={personAssetId}
                  onSelect={setPersonAssetId}
                  kind="person"
                />
              ) : (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  {t('personLibraryEmpty')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 2. 服装参考（优化点3：服装图库） */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">{t('garmentReferenceLabel')}</h3>
          
          {mode === 'product' ? (
            <UploadReferenceCard
              file={garmentFile}
              onFileSelect={setGarmentFile}
              label={t('uploadGarmentLabel')}
              accept="image/*"
              disabled={isSubmitting}
            />
          ) : (
            <div>
              {isGarmentLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : garmentLibrary && garmentLibrary.length > 0 ? (
                <CategoryFilteredLibraryGrid
                  items={garmentLibrary}
                  selectedId={garmentAssetId}
                  onSelect={setGarmentAssetId}
                  kind="garment"
                />
              ) : (
                <div className="rounded-lg border border-dashed border-border p-8 text-center">
                  <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-4 text-sm font-medium">{t('garmentLibraryEmpty')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('garmentLibraryEmptyHint')}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. 姿势参考 */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">{t('poseReferenceLabel')}</h3>
          <p className="mb-4 text-sm text-muted-foreground">{t('poseReferenceHint')}</p>
          
          {isPoseLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : poseLibrary && poseLibrary.length > 0 ? (
            <PoseLibraryWithFilters
              poses={poseLibrary}
              selectedPoseId={poseAssetId}
              onSelectPose={setPoseAssetId}
              disabled={isSubmitting}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {t('poseLibraryEmpty')}
            </div>
          )}
        </div>
      </div>

      {/* 生成配置 */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h3 className="text-lg font-semibold">{t('configTitle')}</h3>

        {/* 提示词 */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('promptLabel')}</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isSubmitting}
            placeholder={t('promptPlaceholder')}
            maxLength={5000}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
          />
          <div className="text-right text-xs text-muted-foreground">
            {t('promptCounter', { count: prompt.length, max: 5000 })}
          </div>
        </div>

        {/* 尺寸和质量 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('sizeLabel')}</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            >
              <option value="1024x1024">{t('sizes.square')}</option>
              <option value="1024x1536">{t('sizes.portrait')}</option>
              <option value="1536x1024">{t('sizes.landscape')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t('qualityLabel')}</label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as any)}
              disabled={isSubmitting}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            >
              <option value="auto">{t('qualities.auto')}</option>
              <option value="standard">{t('qualities.standard')}</option>
              <option value="high">{t('qualities.high')}</option>
            </select>
          </div>
        </div>

        {/* 模型选择（优化点5：确保模型选择可用） */}
        {models && models.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('modelLabel')}</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            >
              <option value="">{t('modelDefault')}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 提交按钮 */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-8 py-3 font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSubmitting
            ? uploadProgress
              ? t('uploadingProgress', { current: uploadProgress.current, total: uploadProgress.total })
              : t('submitting')
            : t('submit')}
        </button>
      </div>

      {/* 任务状态和结果展示（优化点1和2：结果展示+进度条） */}
      {taskId && taskStatus && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          {/* 状态标题 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {(taskStatus.status === 'pending' || taskStatus.status === 'processing') && (
                <Loader2 className="h-5 w-5 animate-spin" />
              )}
              <h3 className="font-semibold">
                {taskStatus.status === 'pending' && t('status.pending')}
                {taskStatus.status === 'processing' && t('status.processing')}
                {taskStatus.status === 'completed' && t('status.completed')}
                {taskStatus.status === 'failed' && t('status.failed')}
              </h3>
            </div>
            {taskStatus.status === 'completed' && (
              <button
                type="button"
                onClick={handleRegenerate}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:border-foreground"
              >
                <RefreshCw className="h-4 w-4" />
                {t('regenerate')}
              </button>
            )}
          </div>

          {/* 进度条（优化点2） */}
          {(taskStatus.status === 'pending' || taskStatus.status === 'processing') && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-foreground transition-all duration-300"
                  style={{ width: `${taskProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{t('progress', { percent: taskProgress })}</span>
                {estimatedTimeText && <span>{estimatedTimeText}</span>}
              </div>
            </div>
          )}

          {/* 结果预览（优化点1：生成结果展示） */}
          {taskStatus.status === 'completed' && resultImageUrl && (
            <div className="space-y-4">
              <div className="relative aspect-square w-full max-w-2xl mx-auto overflow-hidden rounded-lg border border-border">
                <img
                  src={resultImageUrl}
                  alt={t('resultAlt')}
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 font-medium hover:border-foreground sm:flex-none"
                >
                  <Download className="h-4 w-4" />
                  {t('download')}
                </button>
                <button
                  type="button"
                  onClick={handleViewFiles}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 font-medium hover:border-foreground sm:flex-none"
                >
                  <FileText className="h-4 w-4" />
                  {t('viewInFiles')}
                </button>
              </div>
            </div>
          )}

          {/* 失败信息 */}
          {taskStatus.status === 'failed' && (
            <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
              {t('failedMessage')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}





