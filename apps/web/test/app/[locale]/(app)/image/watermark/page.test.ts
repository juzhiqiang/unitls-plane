import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/app/[locale]/(app)/image/watermark/page.tsx'),
  'utf8'
);

describe('image watermark page', () => {
  // 与 compress / convert 对齐:不再手写 while 循环轮询,统一走 runImageTask。
  // 那份手写实现没有超时、没有中止,批量时 N 个文件就是 N 条永不放弃的轮询。
  it('runs the server path through the shared task runner', () => {
    expect(source).toContain('runImageTask');
    // 守卫:页面不得出现手写轮询循环(注释里提到 while 属于说明,不构成实现)。
    expect(source).not.toMatch(/\bwhile\s*\(\s*true\s*\)/);
  });

  it('no longer imports the api client for direct status polling', () => {
    // 轮询已收敛到 waitForTask,页面不应再直接调 api.GET('/tasks/{id}/status')。
    expect(source).not.toContain("api.GET('/tasks/{id}/status')");
  });
});
