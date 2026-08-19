import { useEffect, useState } from 'react';
import { canEncodeImageType } from '@/lib/processing/image-encoding-support';

/**
 * 探测当前浏览器能本地编码哪些图片格式。
 *
 * 初值只包含 canvas 规范保证支持的 JPEG/PNG,WebP 与 AVIF 探测完成后再补进来。
 * 这样在探测返回前 UI 不会把「可能不支持」的格式当成可用 —— 宁可短暂少给一个
 * 选项,也不要让用户点下去之后才失败。
 */
export function useImageEncodingSupport(types: readonly string[]): Set<string> {
  const [supported, setSupported] = useState<Set<string>>(
    () => new Set(['image/jpeg', 'image/png'])
  );
  const key = types.join(',');

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      key
        .split(',')
        .map(async type => [type, await canEncodeImageType(type)] as const)
    ).then(results => {
      if (cancelled) return;
      setSupported(
        new Set(results.filter(([, ok]) => ok).map(([type]) => type))
      );
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return supported;
}
