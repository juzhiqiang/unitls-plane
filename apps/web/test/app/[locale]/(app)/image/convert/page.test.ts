import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/app/[locale]/(app)/image/convert/page.tsx'),
  'utf8'
);

describe('image convert page', () => {
  it('accepts multiple files', () => {
    // convert 长期只支持单文件,而 compress / watermark 都支持多文件,工具间能力不一致。
    expect(source).toContain('multiple');
    expect(source).toContain('items.map');
    expect(source).toContain('FileList');
  });

  it('bundles multiple results into a ZIP', () => {
    // 单/多产物下载分支已抽到 ResultDownloadAction,内部按数量分发到
    // DownloadButton 或 ZipDownloadButton;页面只声明产物,不再手写分支。
    expect(source).toContain('ResultDownloadAction');
    expect(source).toContain('converted-');
  });

  it('runs the server path through the shared task runner', () => {
    // 不再手写 while 循环轮询:那份实现没有超时,批量时 N 个文件就是 N 条永不放弃的轮询。
    expect(source).toContain('runImageTask');
    expect(source).not.toMatch(/\bwhile\s*\(\s*true\s*\)/);
  });

  it('still blocks locally-unencodable formats before processing', () => {
    expect(source).toContain("mode === 'local' && formatNeedsServer");
    expect(source).toContain("t('formatNeedsServerError')");
  });
});

describe('image compress page', () => {
  const compressSource = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(app)/image/compress/page.tsx'),
    'utf8'
  );

  it('shares the same task runner instead of hand-rolled polling', () => {
    expect(compressSource).toContain('runImageTask');
    expect(compressSource).not.toMatch(/\bwhile\s*\(\s*true\s*\)/);
    expect(compressSource).not.toContain('processOnServer');
  });
});
