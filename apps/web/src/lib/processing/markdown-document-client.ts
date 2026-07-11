const MARKDOWN_EXTENSIONS = /\.(md|markdown|mdown|mkdn|txt)$/i;

export function isMarkdownDocumentFile(file: File): boolean {
  return MARKDOWN_EXTENSIONS.test(file.name);
}

export async function readMarkdownDocumentFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buffer);
  return text.replace(/^\uFEFF/, '');
}

export function deriveDocumentPdfFilename(filename: string): string {
  const baseName = filename.replace(
    /\.(md|markdown|mdown|mkdn|txt|docx)$/i,
    ''
  );
  const cleaned = baseName.trim() || 'document';
  return `${cleaned}.pdf`;
}

export function createMarkdownSourceFile(
  markdown: string,
  filename = 'markdown-source.md'
): File {
  const sourceName = isMarkdownDocumentFile(new File([], filename))
    ? filename
    : 'markdown-source.md';
  return new File([markdown], sourceName, { type: 'text/markdown' });
}
