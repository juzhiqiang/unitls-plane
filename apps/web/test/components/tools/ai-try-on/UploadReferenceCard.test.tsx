import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import type { AbstractIntlMessages } from 'next-intl';
import zh from '../../../../messages/zh.json';
import { UploadReferenceCard } from '@/components/tools/ai-try-on/UploadReferenceCard';

vi.mock('@/hooks/use-object-url', () => ({
  useObjectUrl: (file: File | null) => (file ? `blob:${file.name}` : undefined),
}));

describe('UploadReferenceCard', () => {
  it('supports drag and drop file upload', () => {
    const onFileChange = vi.fn();
    const onOversize = vi.fn();

    render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh as unknown as AbstractIntlMessages}
      >
        <UploadReferenceCard
          role="person"
          file={null}
          actionLabel="上传人像照片"
          maxFileSize={10 * 1024 * 1024}
          onFileChange={onFileChange}
          onOversizeError={onOversize}
        />
      </NextIntlClientProvider>
    );

    const dropzone = screen.getByText('点击或拖拽图片至此处').closest('div');
    expect(dropzone).not.toBeNull();

    const testFile = new File(['image-bytes'], 'model.png', {
      type: 'image/png',
    });

    // Simulate drag events
    fireEvent.dragOver(dropzone!);
    expect(screen.getByText('释放图片以上传')).toBeInTheDocument();

    fireEvent.dragLeave(dropzone!);
    expect(screen.getByText('点击或拖拽图片至此处')).toBeInTheDocument();

    // Drop file
    fireEvent.drop(dropzone!, {
      dataTransfer: {
        files: [testFile],
      },
    });

    expect(onFileChange).toHaveBeenCalledTimes(1);
    expect(onFileChange).toHaveBeenCalledWith(testFile);
  });

  it('reports oversize error when dropped file exceeds maxFileSize', () => {
    const onFileChange = vi.fn();
    const onOversize = vi.fn();

    render(
      <NextIntlClientProvider
        locale="zh"
        messages={zh as unknown as AbstractIntlMessages}
      >
        <UploadReferenceCard
          role="garment"
          file={null}
          actionLabel="上传商品实拍图"
          maxFileSize={1024} // 1 KB max
          onFileChange={onFileChange}
          onOversizeError={onOversize}
        />
      </NextIntlClientProvider>
    );

    const dropzone = screen.getByText('点击或拖拽图片至此处').closest('div');
    const largeFile = new File(['x'.repeat(2048)], 'huge.png', {
      type: 'image/png',
    });

    fireEvent.drop(dropzone!, {
      dataTransfer: {
        files: [largeFile],
      },
    });

    expect(onOversize).toHaveBeenCalledTimes(1);
    expect(onFileChange).not.toHaveBeenCalled();
  });
});
