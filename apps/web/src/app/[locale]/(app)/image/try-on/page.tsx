'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAiTryOnReferences } from '@/hooks/api/use-ai-try-on';
import { PoseLibraryWithFilters, UploadReferenceCard } from '@/components/tools/ai-try-on';

type SourceType = 'upload' | 'library';

export default function AiTryOnPage() {
  const t = useTranslations('ImageTryOn');
  
  // 人像选择
  const [personFileId, setPersonFileId] = useState<string | null>(null);
  
  // 服饰选择
  const [garmentFileId, setGarmentFileId] = useState<string | null>(null);
  
  // 姿势选择
  const [poseAssetId, setPoseAssetId] = useState<string | null>(null);
  
  // API hooks
  const { data: poseLibrary, isLoading: isPoseLoading, isError: isPoseError, refetch: refetchPose } = 
    useAiTryOnReferences('pose');
  
  return (
    <div className="container mx-auto max-w-7xl space-y-8 px-4 py-8">
      {/* 页头 */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      
      {/* 人像上传 */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('personLabel')}</h2>
        <UploadReferenceCard
          role="person"
          fileId={personFileId}
          onFileIdChange={setPersonFileId}
        />
      </div>
      
      {/* 服饰上传 */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('garmentLabel')}</h2>
        <UploadReferenceCard
          role="garment"
          fileId={garmentFileId}
          onFileIdChange={setGarmentFileId}
        />
      </div>
      
      {/* 姿势选择 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('poseLabel')}</h2>
          <span className="text-sm text-muted-foreground">{t('optionalLabel')}</span>
        </div>
        
        <PoseLibraryWithFilters
          items={poseLibrary?.items || []}
          selectedId={poseAssetId}
          onSelect={setPoseAssetId}
          isLoading={isPoseLoading}
          isError={isPoseError}
          onRetry={refetchPose}
        />
      </div>
      
      {/* 功能提示 */}
      <div className="rounded-md border border-blue-500/50 bg-blue-500/10 p-4 text-sm text-blue-700 dark:text-blue-300">
        <p className="font-semibold">姿势图库已上线</p>
        <p className="mt-1 text-blue-600 dark:text-blue-400">
          · {poseLibrary?.items?.length || 0} 个姿势可选，支持多视角筛选
        </p>
        <p className="mt-1 text-blue-600 dark:text-blue-400">
          · 任务提交功能即将完成
        </p>
      </div>
    </div>
  );
}
