/**
 * MODNet 输入张量构造与输出 matte 归一化(服务端 onnxruntime-node 与浏览器
 * onnxruntime-web 共用)。
 *
 * 两端必须喂给模型逐元素相同的张量、按同一口径把 matte 转成 alpha 字节,
 * 否则同一张图在本地路与服务端路会出现不同的边缘。
 *
 * - 输入:`(v / 255 - 0.5) / 0.5` 归一化到 [-1, 1],紧密排列的 CHW(R、G、B 三个平面);
 * - 输出:matte 是 0..1 的前景概率,直接 `* 255` 后四舍五入并夹到 0..255,
 *   不做逐图 min/max 拉伸(拉伸会把暗淡输入的背景抬成半透明)。
 *
 * 纯函数,不依赖 Node/Buffer 或 DOM。
 */

/**
 * @param pixels 紧密排列的像素;`channels=3` 为 RGB(sharp raw),
 *   `channels=4` 为 RGBA(canvas `ImageData.data`,A 通道被忽略)
 * @param channels 每像素字节数,决定步长;默认 3
 * @returns 长度 `3 * width * height` 的 CHW float32 张量
 */
export function createModNetInputTensor(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  channels: 3 | 4 = 3
): Float32Array {
  const plane = width * height;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    const offset = i * channels;
    for (let c = 0; c < 3; c += 1) {
      tensor[c * plane + i] = ((pixels[offset + c] ?? 0) / 255 - 0.5) / 0.5;
    }
  }
  return tensor;
}

/**
 * 把 MODNet 输出的 0..1 matte 转成 0..255 的 alpha 字节。
 *
 * @returns 新的 Uint8Array;不修改入参
 */
export function normalizeModNetMatteValues(
  matte: ArrayLike<number>
): Uint8Array {
  const bytes = new Uint8Array(matte.length);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.max(0, Math.min(255, Math.round((matte[i] ?? 0) * 255)));
  }
  return bytes;
}
