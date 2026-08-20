/**
 * 画布面积上限。
 *
 * WebKit(Safari / iOS 上的所有浏览器)对单个 canvas 有约 16.78M 像素的硬上限,
 * 超过后**不报错**,直接产出空白图 —— 长图拼接免费档允许 32M 像素,登录档 96M,
 * 也就是说 Safari 用户拼一张稍长的图就会拿到全白结果,而且完全不知道为什么。
 *
 * 这里只对受限浏览器下调上限,其它浏览器保持原有额度不变。
 */

/** WebKit 的单画布像素上限(16384 × 1024 = 16,777,216)。 */
export const WEBKIT_MAX_CANVAS_PIXELS = 16_777_216;

/**
 * 是否是受面积上限约束的浏览器。
 *
 * 不能只看 UA 里有没有 "Safari" —— Chrome/Edge 的 UA 也带这个词。判据是
 * `navigator.vendor === 'Apple Computer, Inc.'`:这是 WebKit 独有的,且 iOS 上的
 * Chrome/Firefox 底层也是 WebKit,同样会命中,正是我们要覆盖的范围。
 *
 * 注意:jsdom 的 navigator.vendor 默认就是 'Apple Computer, Inc.',所以在单测里
 * 不传参会被判为受限。要测「非 WebKit」必须显式传入 navigator 替身。
 */
export function isAreaLimitedCanvas(
  navigatorLike: { vendor?: string } | undefined = typeof navigator !==
  'undefined'
    ? navigator
    : undefined
): boolean {
  return navigatorLike?.vendor === 'Apple Computer, Inc.';
}

/**
 * 把额度上限与浏览器上限取较小者。
 *
 * 返回 limited 供 UI 判断该不该解释「这不是账号限制,是浏览器限制」—— 用户看到
 * 登录后额度没变大会很困惑,必须说清原因。
 */
export function resolveCanvasPixelLimit(
  planLimit: number,
  areaLimited = isAreaLimitedCanvas()
): { limit: number; limited: boolean } {
  if (!areaLimited || planLimit <= WEBKIT_MAX_CANVAS_PIXELS) {
    return { limit: planLimit, limited: false };
  }
  return { limit: WEBKIT_MAX_CANVAS_PIXELS, limited: true };
}
