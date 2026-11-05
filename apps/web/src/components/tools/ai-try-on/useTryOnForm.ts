'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AiTryOnMode } from '@/hooks/api/types';
import type { TryOnPersonSource } from './types';

export function useTryOnForm() {
  const t = useTranslations('ImageTryOn');
  const [mode, setMode] = useState<AiTryOnMode>('product');
  const [personSource, setPersonSource] = useState<TryOnPersonSource>('upload');
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [personAssetId, setPersonAssetId] = useState<string | null>(null);
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [garmentAssetId, setGarmentAssetId] = useState<string | null>(null);
  const [poseAssetId, setPoseAssetId] = useState<string | null>(null);
  const [styleAssetId, setStyleAssetId] = useState<string | null>(null);
  const [promptAddition, setPromptAddition] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState<'auto' | 'standard' | 'high'>('high');
  const [model, setModel] = useState('');

  // 应用快速体验预设
  const handleApplyPreset = (preset: {
    personAssetId: string;
    garmentAssetId: string;
    poseAssetId: string;
    promptAddition: string;
  }) => {
    setMode('inspiration');
    setPersonSource('library');
    setPersonAssetId(preset.personAssetId);
    setPersonFile(null);
    setGarmentAssetId(preset.garmentAssetId);
    setGarmentFile(null);
    setPoseAssetId(preset.poseAssetId);
    setPromptAddition(preset.promptAddition);
  };

  const handleToggleSceneChip = (chipValue: string) => {
    setPromptAddition(prev => {
      const trimmed = prev.trim();
      const delimiter = t('workbench.sceneDelimiter');
      if (trimmed.includes(chipValue)) {
        const cleaned = trimmed
          .replace(
            new RegExp(
              `(，\\s*${chipValue}|${chipValue}，?|\\b${chipValue}\\b)`,
              'g'
            ),
            ''
          )
          .trim();
        return cleaned.replace(/^[，,\s]+|[，,\s]+$/g, '');
      }
      return trimmed ? `${trimmed}${delimiter}${chipValue}` : chipValue;
    });
  };

  const resetSelections = () => {
    setPersonFile(null);
    setPersonAssetId(null);
    setGarmentFile(null);
    setGarmentAssetId(null);
    setPoseAssetId(null);
    setStyleAssetId(null);
    setPromptAddition('');
  };

  return {
    mode,
    setMode,
    personSource,
    setPersonSource,
    personFile,
    setPersonFile,
    personAssetId,
    setPersonAssetId,
    garmentFile,
    setGarmentFile,
    garmentAssetId,
    setGarmentAssetId,
    poseAssetId,
    setPoseAssetId,
    styleAssetId,
    setStyleAssetId,
    promptAddition,
    setPromptAddition,
    size,
    setSize,
    quality,
    setQuality,
    model,
    setModel,
    resetSelections,
    handleApplyPreset,
    handleToggleSceneChip,
  };
}

export type TryOnForm = ReturnType<typeof useTryOnForm>;
