/**
 * 存储文件的下载链接与浏览器下载触发工具。
 *
 * `/files/:id/download` 默认返回 `Content-Disposition: inline`，用于头像、生图结果等
 * 内联预览场景；由于 API 与 Web 属于不同 origin，锚点的 `download` 属性会被浏览器忽略，
 * 图片和 PDF 会被直接预览。需要「直接下载」时必须带上 `?download=1`，让服务端返回
 * `attachment`。
 */
export interface FileDownloadUrlOptions {
  /** true 时请求服务端以附件形式返回，浏览器直接保存而不是预览。 */
  attachment?: boolean;
}

export function buildFileDownloadUrl(
  fileId: string,
  options: FileDownloadUrlOptions = {}
): string {
  const base = `${process.env.NEXT_PUBLIC_API_URL}/files/${fileId}/download`;
  return options.attachment ? `${base}?download=1` : base;
}

export function triggerBrowserDownload(url: string, filename?: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  if (filename) anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** 直接下载已存储文件（图片、PDF、字体等），不打开预览页面。 */
export function downloadStoredFile(fileId: string, filename?: string): void {
  triggerBrowserDownload(
    buildFileDownloadUrl(fileId, { attachment: true }),
    filename
  );
}
