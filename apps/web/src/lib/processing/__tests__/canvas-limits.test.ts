import { describe, expect, it } from 'vitest';
import {
  isAreaLimitedCanvas,
  resolveCanvasPixelLimit,
  WEBKIT_MAX_CANVAS_PIXELS,
} from '../canvas-limits';

describe('isAreaLimitedCanvas', () => {
  it('detects WebKit by vendor', () => {
    expect(isAreaLimitedCanvas({ vendor: 'Apple Computer, Inc.' })).toBe(true);
  });

  it('does not misfire on Chrome or Firefox', () => {
    // Chrome 的 UA 里也有 "Safari",只能靠 vendor 区分。
    expect(isAreaLimitedCanvas({ vendor: 'Google Inc.' })).toBe(false);
    expect(isAreaLimitedCanvas({ vendor: '' })).toBe(false);
    expect(isAreaLimitedCanvas({})).toBe(false);
  });
});

describe('resolveCanvasPixelLimit', () => {
  it('leaves other browsers untouched', () => {
    expect(resolveCanvasPixelLimit(96_000_000, false)).toEqual({
      limit: 96_000_000,
      limited: false,
    });
  });

  it('caps WebKit at the canvas area limit', () => {
    // 长图拼接免费档 32M、登录档 96M,都超过 WebKit 上限;超限时 Safari 不报错,
    // 直接产出空白图,所以必须提前挡下。
    expect(resolveCanvasPixelLimit(32_000_000, true)).toEqual({
      limit: WEBKIT_MAX_CANVAS_PIXELS,
      limited: true,
    });
    expect(resolveCanvasPixelLimit(96_000_000, true).limit).toBe(
      WEBKIT_MAX_CANVAS_PIXELS
    );
  });

  it('does not raise a plan limit that is already lower', () => {
    // 额度比浏览器上限还小时不该被「放宽」,也不该报告成浏览器限制。
    expect(resolveCanvasPixelLimit(8_000_000, true)).toEqual({
      limit: 8_000_000,
      limited: false,
    });
  });

  it('reports limited only when the browser is the binding constraint', () => {
    expect(
      resolveCanvasPixelLimit(WEBKIT_MAX_CANVAS_PIXELS, true).limited
    ).toBe(false);
    expect(
      resolveCanvasPixelLimit(WEBKIT_MAX_CANVAS_PIXELS + 1, true).limited
    ).toBe(true);
  });
});
