import { useEffect, useState } from 'react';

/**
 * 为一组 File/Blob 创建 object URL(与输入下标对齐),在依赖变化或卸载时统一 revoke。
 * 传入空数组返回空数组;个别槽位创建失败(理论不可达)为 undefined,调用方按占位处理。
 */
export function useObjectUrls(files: File[] | Blob[]): Array<string | undefined> {
  const [urls, setUrls] = useState<Array<string | undefined>>([]);

  useEffect(() => {
    const created = files.map(file => URL.createObjectURL(file));
    setUrls(created);
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
    };
    // files 是数组引用:调用方传 state 数组,增删都会换引用,浅比较足够。
  }, [files]);

  return urls;
}
