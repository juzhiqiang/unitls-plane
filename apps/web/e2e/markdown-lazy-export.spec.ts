import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('slow Markdown loading cannot print an empty document and can be retried', async ({
  page,
}) => {
  const manifest = JSON.parse(
    readFileSync(resolve('apps/web/.next/react-loadable-manifest.json'), 'utf8')
  ) as Record<string, { files: string[] }>;
  const renderer = Object.entries(manifest).find(([name]) =>
    name.endsWith(' -> ./markdown-renderer')
  );
  expect(renderer).toBeDefined();
  const chunk = renderer![1].files.at(-1)!;
  let release!: () => void;
  const gate = new Promise<void>(resolveGate => {
    release = resolveGate;
  });
  await page.route(`**/_next/${chunk}`, async route => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/zh/pdf/from-document', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-markdown-loading]')).toHaveCount(1);
    await page
      .getByRole('button', { name: '本地导出 PDF', exact: true })
      .click();
    await expect(
      page.getByText('预览尚未准备好，请切回预览后重试。')
    ).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.locator('.markdown-body h1')).toHaveText('Project Brief');
  // 检查实际打印文档与 print 调用，避免打开交互式系统打印窗口。
  await page.evaluate(() => {
    const append = document.body.appendChild.bind(document.body);
    document.body.appendChild = function <T extends Node>(node: T): T {
      const result = append(node);
      if (node instanceof HTMLIFrameElement && node.contentWindow) {
        node.contentWindow.print = () =>
          node.setAttribute('data-printed', 'true');
      }
      return result;
    };
  });
  await page.getByRole('button', { name: '本地导出 PDF', exact: true }).click();
  await expect(page.locator('iframe[data-printed]')).toHaveCount(1);
  await expect(page.frameLocator('iframe').locator('h1')).toHaveText(
    'Project Brief'
  );
});
