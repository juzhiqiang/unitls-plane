'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAiTryOnReferences } from '@/hooks/api/use-ai-try-on';
import { PoseLibraryWithFilters, UploadReferenceCard } from '@/components/tools/ai-try-on';

export default function AiTryOnPage() {
  const t = useTranslations('ImageTryOn');
  
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [poseAssetId, setPoseAssetId] = useState<string | null>(null);
  
  const { data: poseLibrary, isLoading: isPoseLoading, isError: isPoseError, refetch: refetchPose } = 
    useAiTryOnReferences('pose');
  
  return (
    <div className="container mx-auto max-w-7xl space-y-8 px-4 py-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('personLabel')}</h2>
        <UploadReferenceCard
          role="person"
          file={personFile}
          actionLabel={t('personUploadAction') || '上传人像照片'}
          maxFileSize={10 * 1024 * 1024}
          onFileChange={setPersonFile}
          onOversizeError={(maxSizeFormatted) => {
            alert(t('errors.fileTooLarge', { size: maxSizeFormatted }));
          }}
        />
      </div>
      
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('garmentLabel')}</h2>
        <UploadReferenceCard
          role="garment"
          file={garmentFile}
          actionLabel={t('garmentUploadAction') || '上传商品实拍图'}
          maxFileSize={10 * 1024 * 1024}
          onFileChange={setGarmentFile}
          onOversizeError={(maxSizeFormatted) => {
            alert(t('errors.fileTooLarge', { size: maxSizeFormatted }));
          }}
        />
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('poseLabel')}</h2>
          <span className="text-sm text-muted-foreground">{t('optionalLabel')}</span>
        </div>
        
        <PoseLibraryWithFilters
          items={poseLibrary || []}
          selectedId={poseAssetId}
          onSelect={setPoseAssetId}
          isLoading={isPoseLoading}
          isError={isPoseError}
          onRetry={refetchPose}
        />
      </div>
      
      <div className="rounded-md border border-blue-500/50 bg-blue-500/10 p-4 text-sm">
        <p className="font-semibold text-blue-700 dark:text-blue-300">
          ✨ 姿势图库已上线
        </p>
        <ul className="mt-2 space-y-1 text-blue-600 dark:text-blue-400">
          <li>· {poseLibrary?.length || 0} 个姿势可选，支持多视角筛选</li>
          <li>· 文件上传组件已集成</li>
          <li>· 任务提交功能开发中</li>
        </ul>
      </div>
    </div>
  );
}
