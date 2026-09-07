'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 单个账号文件的 blob 预览 URL。对话式生图页用它把图生图消息里的参考图
 * (inputFileIds[0])显示成缩略图,与 useTaskOutputPreviews 同一套
 * fetch → blob → objectURL 模式,只是单文件版。
 *
 * fileId 变化时重新拉取;blob URL 只在 fileId 变化与卸载时 revoke,
 * 下载链接在组件生命周期内一直有效。
 */
export function useFilePreviewUrl(fileId?: string): string | undefined {
  const [url, setUrl] = useState<string>();

  // 保存当前 URL 的 ref,卸载与切换时 revoke 用。
  const urlRef = useRef<string>();
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    let cancelled = false;

    if (!fileId) {
      setUrl(undefined);
      return;
    }

    (async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/files/${fileId}/download`,
          { credentials: 'include' }
        );
        if (!response.ok) throw new Error('Download failed');
        const next = URL.createObjectURL(await response.blob());
        if (cancelled) {
          URL.revokeObjectURL(next);
          return;
        }
        setUrl(current => {
          if (current) URL.revokeObjectURL(current);
          return next;
        });
      } catch {
        // 取不回参考图不是致命错误:消息里只是少一张缩略图。
        if (!cancelled) setUrl(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId]);

  // 卸载时回收最后一张 blob URL。
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  return url;
}
