import { expect, test } from '@playwright/test';

test.use({
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'no-preference',
});

test('Hero pauses just outside the viewport and resumes one frame loop', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set<number>();
    const probe = { frames: 0, maximumPending: 0, pending: 0 };
    Object.assign(window, { heroFrameProbe: probe });
    window.requestAnimationFrame = callback => {
      const id = original(time => {
        pending.delete(id);
        probe.pending = pending.size;
        probe.frames += 1;
        callback(time);
      });
      pending.add(id);
      probe.pending = pending.size;
      probe.maximumPending = Math.max(probe.maximumPending, pending.size);
      return id;
    };
    window.cancelAnimationFrame = id => {
      pending.delete(id);
      probe.pending = pending.size;
      cancel(id);
    };
  });
  const probe = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            heroFrameProbe: {
              frames: number;
              maximumPending: number;
              pending: number;
            };
          }
        ).heroFrameProbe
    );
  await page.goto('/zh');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await probe()).frames).toBeGreaterThan(5);

  // 离屏仅 20px，避免把扩展的预加载区域误当作可见区域。
  await canvas.evaluate(element => {
    window.scrollTo(
      0,
      window.scrollY + element.getBoundingClientRect().bottom + 20
    );
  });
  await expect.poll(async () => (await probe()).pending).toBe(0);
  const paused = await probe();
  // 验收要求连续三秒不执行动画帧。
  await page.waitForTimeout(3100);
  expect((await probe()).frames).toBe(paused.frames);

  await page.evaluate(() => {
    (
      window as unknown as { heroFrameProbe: { maximumPending: number } }
    ).heroFrameProbe.maximumPending = 0;
    window.scrollTo(0, 0);
  });
  await expect
    .poll(async () => (await probe()).frames)
    .toBeGreaterThan(paused.frames + 5);
  expect((await probe()).maximumPending).toBe(1);
});
