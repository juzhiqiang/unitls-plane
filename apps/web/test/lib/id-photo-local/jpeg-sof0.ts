/**
 * 测试辅助:从 JPEG 字节里解析 SOF0(baseline,标记 0xFFC0)。
 *
 * canvas 的编码器/封装库不暴露采样参数,只能回到码流本身:SOF0 分量表的
 * 采样因子是唯一权威来源。4:4:4 要求三个分量都为 0x11。
 *
 * composite 与 dpi-metadata 两组用例共用,避免各自维护一份解析器。
 */

export interface SofComponent {
  id: number;
  /** 低 4 位水平采样因子，高 4 位垂直采样因子；0x11 表示无下采样。 */
  sampling: number;
}

export function parseSof0(bytes: Uint8Array): {
  width: number;
  height: number;
  components: SofComponent[];
} {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('not a JPEG');
  }
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = bytes[pos + 1]!;
    // 0xFF 填充字节
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    // 无长度字段的独立标记
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    // 扫描开始/图像结束之后不会再有 SOF0
    if (marker === 0xda || marker === 0xd9) break;

    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    if (marker === 0xc0) {
      const height = (bytes[pos + 5]! << 8) | bytes[pos + 6]!;
      const width = (bytes[pos + 7]! << 8) | bytes[pos + 8]!;
      const count = bytes[pos + 9]!;
      const components: SofComponent[] = [];
      for (let i = 0; i < count; i += 1) {
        const base = pos + 10 + i * 3;
        components.push({ id: bytes[base]!, sampling: bytes[base + 1]! });
      }
      return { width, height, components };
    }
    pos += 2 + length;
  }
  throw new Error('SOF0 segment not found');
}
