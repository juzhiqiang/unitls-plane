import { useEffect, useState } from 'react';

/**
 * 为 File/Blob 创建 object URL,并在依赖变化或组件卸载时自动 revoke,
 * 避免内存泄漏。传入 null 时返回 null。
 */
export function useObjectUrl(file: File | Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return url;
}
