/**
 * YuNet 输出张量解析。
 *
 * YuNet（face_detection_yunet_2023mar.onnx）的输出是 `[batch, 15]`：
 *   [0..3]   x, y, w, h        —— 人脸框（输入分辨率下的像素坐标）
 *   [4..13]  5 个关键点 x,y     —— 左眼、右眼、鼻尖、左嘴角、右嘴角
 *   [14]     score
 *
 * 未使用的 anchor 会被填 0，这里用 score 过滤。
 *
 * 放在 packages/utils 而不是各自端里：onnxruntime-web 和 onnxruntime-node
 * 拿到的都是 Float32Array，解析逻辑完全一样，写两份必然漂移。
 */

export const YUNET_INPUT_SIZE = 320;
export const YUNET_STRIDE = 15;

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
  landmarks: Array<[number, number]>;
  score: number;
}

/**
 * 把 YuNet 的扁平输出切成人脸列表，按 score 降序。
 *
 * `stride` 默认 15；显式传参是为了让调用方面对模型变体时有逃生口。
 */
export function parseYunetOutput(
  values: ArrayLike<number>,
  stride: number = YUNET_STRIDE,
  confidenceThreshold = 0.6
): DetectedFace[] {
  if (stride < 15) {
    throw new Error(`unexpected YuNet stride: ${stride}`);
  }
  const rows = Math.floor(values.length / stride);
  const faces: DetectedFace[] = [];

  for (let r = 0; r < rows; r += 1) {
    const base = r * stride;
    const score = values[base + 14] ?? 0;
    if (!(score >= confidenceThreshold)) continue;

    const x = values[base] ?? 0;
    const y = values[base + 1] ?? 0;
    const width = values[base + 2] ?? 0;
    const height = values[base + 3] ?? 0;
    if (width <= 0 || height <= 0) continue;

    const landmarks: Array<[number, number]> = [];
    for (let k = 0; k < 5; k += 1) {
      landmarks.push([
        values[base + 4 + k * 2] ?? 0,
        values[base + 5 + k * 2] ?? 0,
      ]);
    }

    faces.push({ box: { x, y, width, height }, landmarks, score });
  }

  return faces.sort((a, b) => b.score - a.score);
}

/**
 * 把人脸框与关键点从模型输入分辨率映射回源图分辨率。
 *
 * 预处理若是等比缩放 + 居中补边，需要传 `letterbox` 的偏移与比例；
 * 简单拉伸则传 `scaleX/scaleY` 即可。
 */
export function scaleDetectedFaces(
  faces: DetectedFace[],
  scale: { scaleX: number; scaleY: number; offsetX?: number; offsetY?: number }
): DetectedFace[] {
  const { scaleX, scaleY, offsetX = 0, offsetY = 0 } = scale;
  return faces.map(face => ({
    box: {
      x: (face.box.x - offsetX) * scaleX,
      y: (face.box.y - offsetY) * scaleY,
      width: face.box.width * scaleX,
      height: face.box.height * scaleY,
    },
    landmarks: face.landmarks.map(
      ([lx, ly]) =>
        [(lx - offsetX) * scaleX, (ly - offsetY) * scaleY] as [number, number]
    ),
    score: face.score,
  }));
}
