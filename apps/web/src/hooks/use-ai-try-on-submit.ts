'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api-client';
import { buildImageTryOnTaskPayload, type BuildImageTryOnPayloadInput, type TryOnValidationErrorKey } from '@/components/tools/ai-try-on';

export function useAiTryOnSubmit() {
  const t = useTranslations('ImageTryOn');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

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

  const submitTryOnTask = useCallback(async (input: BuildImageTryOnPayloadInput) => {
    setIsSubmitting(true);
    setUploadProgress(null);

    try {
      const filesToUpload: Array<{ file: File; role: 'person' | 'garment' }> = [];

      if (input.person?.source === 'upload' && (input.person as any).file) {
        filesToUpload.push({ file: (input.person as any).file, role: 'person' });
      }
      if (input.garment?.source === 'upload' && (input.garment as any).file) {
        filesToUpload.push({ file: (input.garment as any).file, role: 'garment' });
      }

      if (filesToUpload.length > 0) {
        setUploadProgress({ current: 0, total: filesToUpload.length });
        
        for (let i = 0; i < filesToUpload.length; i++) {
          const { file, role } = filesToUpload[i];
          const fileId = await uploadFile(file);
          
          if (role === 'person' && input.person?.source === 'upload') {
            (input.person as any).fileId = fileId;
            delete (input.person as any).file;
          }
          if (role === 'garment' && input.garment?.source === 'upload') {
            (input.garment as any).fileId = fileId;
            delete (input.garment as any).file;
          }
          
          setUploadProgress({ current: i + 1, total: filesToUpload.length });
        }
      }

      const payloadResult = buildImageTryOnTaskPayload(input);

      if (!payloadResult.ok) {
        throw new Error(t(`errors.${payloadResult.errorKey}` as any));
      }

      const { data, error } = await api.POST('/tasks', {
        body: payloadResult.payload as any,
      });

      if (error || !data) {
        throw new Error(t('errors.failed'));
      }

      return (data as any).id;
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  }, [t, uploadFile]);

  return {
    submitTryOnTask,
    isSubmitting,
    uploadProgress,
  };
}
