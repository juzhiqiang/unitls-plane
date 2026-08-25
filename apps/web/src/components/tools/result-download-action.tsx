'use client';

import { useTranslations } from 'next-intl';
import { DownloadButton } from './download-button';
import { ZipDownloadButton } from './zip-download-button';

export interface ResultDownloadActionProps {
  /**
   * 一个或多个产物文件。多于一个时打包成 ZIP 下载,单个则直接下载。
   * 这套"单文件直下 / 多文件打 ZIP"的分支在 compress / convert / watermark
   * 三个页面逐字重复,抽到这里让结果块只声明产物、不关心分支。
   */
  files: File[];
  /** 多文件打包时的 ZIP 文件名;单文件时用文件自身名字。 */
  zipName: string;
  className?: string;
}

/**
 * 根据产物数量渲染对应下载按钮:单文件 → DownloadButton,多文件 → ZipDownloadButton。
 *
 * 之前 compress / convert / watermark 各自手写
 *   `successResults.length === 1 ? <DownloadButton/> : <ZipDownloadButton/>`
 * 三份一模一样的分支。这里是它们的单一来源。
 */
export function ResultDownloadAction({
  files,
  zipName,
  className,
}: ResultDownloadActionProps) {
  // 空数组不应到达这里(调用方在 hasAnyResult 为真才渲染结果块),
  // 但仍兜底返回 null,避免 ZipDownloadButton 对空数组报 "0 files" 的文案。
  if (files.length === 0) return null;

  if (files.length === 1) {
    return <DownloadButton file={files[0]!} className={className} />;
  }

  return (
    <ZipDownloadButton files={files} zipName={zipName} className={className} />
  );
}

export { DownloadButton, ZipDownloadButton };
