import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import type { AbstractIntlMessages } from 'next-intl';
import zh from '../../../../messages/zh.json';
import { TryOnCompositionStrip } from '@/components/tools/ai-try-on/TryOnCompositionStrip';
import type { AiTryOnReferenceAssetDto } from '@/hooks/api/types';

const MOCK_PERSON: AiTryOnReferenceAssetDto = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'person',
  title: '法国女模',
  description: '优雅正面人像',
  tags: ['female', 'fr'],
  thumbnailUrl: 'https://cdn.example.test/person.webp',
  sourceUrl: 'https://source.example.test/person',
  licenseName: 'CC0',
  attribution: 'Studio',
};

const MOCK_GARMENT: AiTryOnReferenceAssetDto = {
  id: '00000000-0000-4000-8000-000000000002',
  kind: 'garment',
  title: '卡其色风衣',
  description: '双排扣羊毛大衣',
  tags: ['coat'],
  thumbnailUrl: 'https://cdn.example.test/garment.webp',
  sourceUrl: 'https://source.example.test/garment',
  licenseName: 'CC0',
  attribution: 'Studio',
};

describe('TryOnCompositionStrip', () => {
  it('renders missing status when person or garment is missing', () => {
    render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh as unknown as AbstractIntlMessages}
      >
        <TryOnCompositionStrip
          personFile={null}
          personAsset={null}
          onClearPerson={vi.fn()}
          garmentFile={null}
          garmentAsset={null}
          onClearGarment={vi.fn()}
          poseAsset={null}
          onClearPose={vi.fn()}
          styleAsset={null}
          onClearStyle={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText('尚缺核心要素')).toBeInTheDocument();
    expect(screen.getByText('+ 选择模特人像')).toBeInTheDocument();
    expect(screen.getByText('+ 上传/选择目标服装')).toBeInTheDocument();
  });

  it('renders ready status and handles clear buttons when references are filled', () => {
    const onClearPerson = vi.fn();
    const onClearGarment = vi.fn();
    const onResetAll = vi.fn();

    render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh as unknown as AbstractIntlMessages}
      >
        <TryOnCompositionStrip
          personFile={null}
          personAsset={MOCK_PERSON}
          onClearPerson={onClearPerson}
          garmentFile={null}
          garmentAsset={MOCK_GARMENT}
          onClearGarment={onClearGarment}
          poseAsset={null}
          onClearPose={vi.fn()}
          styleAsset={null}
          onClearStyle={vi.fn()}
          onResetAll={onResetAll}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText('核心要素已就绪')).toBeInTheDocument();
    expect(screen.getByText('法国女模')).toBeInTheDocument();
    expect(screen.getByText('卡其色风衣')).toBeInTheDocument();

    // Clear person button
    const removeButtons = screen.getAllByTitle('移除此项');
    expect(removeButtons.length).toBe(2);
    fireEvent.click(removeButtons[0]!);
    expect(onClearPerson).toHaveBeenCalledTimes(1);

    // Reset all button
    fireEvent.click(screen.getByText('清空全部搭配'));
    expect(onResetAll).toHaveBeenCalledTimes(1);
  });
});
