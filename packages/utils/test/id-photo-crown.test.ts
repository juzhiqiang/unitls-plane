import { describe, expect, it } from 'bun:test';
import { findCrownY } from '../src/id-photo-crown';

/** 按单通道 alpha 构造蒙版。 */
function grayMask(
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number
): Uint8Array {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = alphaAt(x, y);
    }
  }
  return data;
}

/**
 * 同一份蒙版的 RGBA 版本:RGB 填与 alpha 不同的干扰值,
 * 步长或偏移写错时会读到这些值而不是 alpha。
 */
function rgbaMask(
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = alphaAt(x, y);
    }
  }
  return data;
}

describe('findCrownY', () => {
  it('rejects 1 px and 2 px noise rows', () => {
    // width=10 → 门槛 max(3, 0.2)=3。第 0 行 1 个像素、第 1 行 2 个像素都是噪点。
    const alphaAt = (x: number, y: number) => {
      if (y === 0) return x === 0 ? 200 : 0;
      if (y === 1) return x < 2 ? 200 : 0;
      if (y === 2) return x < 3 ? 200 : 0;
      return 0;
    };
    expect(findCrownY(grayMask(10, 4, alphaAt), 10, 4, 1)).toBe(2);
    expect(findCrownY(rgbaMask(10, 4, alphaAt), 10, 4, 4)).toBe(2);
  });

  it('accepts a row that exactly reaches the width-scaled threshold', () => {
    // width=1000 → 门槛 max(3, 20)=20。19 个像素的行仍算噪点,恰好 20 个才算头顶。
    const alphaAt = (x: number, y: number) => {
      if (y === 0) return x < 19 ? 200 : 0;
      if (y === 1) return x < 20 ? 200 : 0;
      return 0;
    };
    expect(findCrownY(grayMask(1000, 3, alphaAt), 1000, 3, 1)).toBe(1);
    expect(findCrownY(rgbaMask(1000, 3, alphaAt), 1000, 3, 4)).toBe(1);
  });

  it('does not count alpha = 96 as foreground', () => {
    // 半透明边缘(<=96)不是前景;第 0 行即使整行都是 96 也不通过,97 才算。
    const alphaAt = (x: number, y: number) => {
      if (y === 0) return 96;
      return x < 3 ? 97 : 0;
    };
    expect(findCrownY(grayMask(10, 2, alphaAt), 10, 2, 1)).toBe(1);
    expect(findCrownY(rgbaMask(10, 2, alphaAt), 10, 2, 4)).toBe(1);
  });

  it('returns undefined for a fully transparent mask', () => {
    expect(
      findCrownY(
        grayMask(10, 4, () => 0),
        10,
        4,
        1
      )
    ).toBeUndefined();
    expect(
      findCrownY(
        rgbaMask(10, 4, () => 0),
        10,
        4,
        4
      )
    ).toBeUndefined();
  });

  it('returns the same row for the same image in 1-channel and 4-channel layouts', () => {
    // 不规则蒙版:顶部散点 + 斜向发际线,行内前景数逐行变化。
    const width = 64;
    const height = 48;
    const alphaAt = (x: number, y: number) => {
      if (y === 3 && (x === 5 || x === 40)) return 255;
      if (y >= 9 && Math.abs(x - 32) <= (y - 9) * 2) return 180;
      return (x * 7 + y * 3) % 90;
    };

    const gray = findCrownY(grayMask(width, height, alphaAt), width, height, 1);
    const rgba = findCrownY(rgbaMask(width, height, alphaAt), width, height, 4);

    expect(gray).toBe(10);
    expect(rgba).toBe(gray);
  });
});
