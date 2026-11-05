import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import type { AbstractIntlMessages } from 'next-intl';
import zh from '../../../../messages/zh.json';
import { TryOnPresetsBar } from '@/components/tools/ai-try-on/TryOnPresetsBar';
import type { AiTryOnReferenceAssetDto } from '@/hooks/api/types';

const MOCK_PERSONS: AiTryOnReferenceAssetDto[] = [
  {
    id: 'person-female-1',
    kind: 'person',
    title: '法国女模',
    tags: ['female', 'fr'],
    thumbnailUrl: 'https://cdn.example.test/person.webp',
    sourceUrl: 'https://source.example.test/person',
    licenseName: 'CC0',
    attribution: 'Studio',
  },
  {
    id: 'person-male-1',
    kind: 'person',
    title: '商务男模',
    tags: ['male'],
    thumbnailUrl: 'https://cdn.example.test/male.webp',
    sourceUrl: 'https://source.example.test/male',
    licenseName: 'CC0',
    attribution: 'Studio',
  },
];

const MOCK_GARMENTS: AiTryOnReferenceAssetDto[] = [
  {
    id: 'garment-1',
    kind: 'garment',
    title: '卡其色风衣',
    tags: ['coat'],
    thumbnailUrl: 'https://cdn.example.test/garment.webp',
    sourceUrl: 'https://source.example.test/garment',
    licenseName: 'CC0',
    attribution: 'Studio',
  },
];

const MOCK_POSES: AiTryOnReferenceAssetDto[] = [
  {
    id: 'pose-1',
    kind: 'pose',
    title: '自然站姿',
    tags: ['standing'],
    thumbnailUrl: 'https://cdn.example.test/pose.webp',
    sourceUrl: 'https://source.example.test/pose',
    licenseName: 'CC0',
    attribution: 'Studio',
  },
];

describe('TryOnPresetsBar', () => {
  it('renders presets and applies preset when clicked', () => {
    const onApply = vi.fn();

    render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh as unknown as AbstractIntlMessages}
      >
        <TryOnPresetsBar
          personLibrary={MOCK_PERSONS}
          garmentLibrary={MOCK_GARMENTS}
          poseLibrary={MOCK_POSES}
          onApplyPreset={onApply}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText('快速体验灵感预设：')).toBeInTheDocument();
    expect(screen.getByText('法式优雅风衣')).toBeInTheDocument();
    expect(screen.getByText('商务绅士西装')).toBeInTheDocument();

    fireEvent.click(screen.getByText('法式优雅风衣'));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      personAssetId: 'person-female-1',
      garmentAssetId: 'garment-1',
      poseAssetId: 'pose-1',
      promptAddition: '极简纯白影棚，柔和摄影棚漫射光，高端电商画册质感',
    });
  });
});
