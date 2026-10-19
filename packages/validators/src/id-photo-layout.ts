/**
 * 人脸自动构图。
 *
 * 对应参考实现 face.py:suggest_layout —— 用 YuNet 的人脸框与 5 点关键点，
 * 算出「让这张脸在成片里占到标准比例」所需的缩放、偏移与旋转。
 *
 * 关键指标（证件照通用经验值，与参考实现一致）：
 * - 人脸宽度占成片 35%（质量检查的合格区间是 26%~42%）
 * - 头顶留白约为成片高度的 8%
 * - 眼线倾斜超过 3° 才旋转修正，且最多 ±5°（再多就该重拍了）
 *
 * 缩放只放大不缩小。`IdPhotoCrop.scale` 的契约是 `[1, 3]`（只放大不缩小），
 * 参考实现里 `zoom < 100` 的「缩小画面补画布」扩展能力受该契约限制，未实现；
 * 因此本模块输出的 `zoom` 下限为 100。
 *
 * 纯函数：不依赖 DOM、不依赖模型，输入是普通对象。
 */

import type { IdPhotoCrop, IdPhotoCropBox } from './id-photo';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceDetection {
  box: FaceBox;
  /** 5 点：左眼、右眼、鼻尖、左嘴角、右嘴角。 */
  landmarks: ReadonlyArray<readonly [number, number]>;
  score: number;
}

export interface IdPhotoLayout {
  /** 100 = 基准框不缩放；>100 放大画面（裁得更紧）。区间 [100, 145]。 */
  zoom: number;
  /** 裁剪框中心相对源图中心的归一化水平偏移，区间 [-20, 20]。 */
  offsetX: number;
  /** 同上，垂直方向。 */
  offsetY: number;
  /**
   * 眼线倾斜的修正量，区间 [-5, 5]。
   *
   * 正值表示右眼低于左眼时的修正方向；具体旋转方向（顺时针/逆时针）由调用方
   * 结合自身坐标系决定，本模块不做约定。
   */
  rotation: number;
  /** 人脸宽度占裁剪框宽度的比例，用于质量面板与调试。 */
  faceRatio: number;
  /**
   * 人脸框（发际线）上沿到裁剪框上沿的距离占裁剪框高度的比例。
   *
   * 不等于 Task 5 质量检查里的 `headroom`：那边按「真实头顶到成片上沿」重新
   * 计算，而这里用 YuNet 人脸框上沿（发际线）估算。构图本身会把「头顶」固定
   * 在 8% 的留白上，若直接报告头顶到裁剪框上沿的距离，结果恒为 8%、无法反映
   * 蒙版提供的真实头顶。提供真实头顶时裁剪框会被整体上移，该值随之变大；
   * 只靠人脸框估算时更小。
   */
  faceTopMargin: number;
}

const DESIRED_FACE_RATIO = 0.35;
const TOP_MARGIN_RATIO = 0.08;
const MIN_ZOOM = 100;
const MAX_ZOOM = 145;
const MAX_OFFSET = 20;
const CROWN_FACE_GAP = 0.28;
const CROWN_PLAUSIBLE_SLACK = 0.12;
const ROTATION_THRESHOLD = 3;
const ROTATION_GAIN = 1.4;
const MAX_ROTATION = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 两眼连线相对水平线的夹角（度）。右眼低于左眼时为正。 */
export function eyeTiltDegrees(
  landmarks: ReadonlyArray<readonly [number, number]>
): number {
  const left = landmarks[0];
  const right = landmarks[1];
  if (!left || !right) return 0;
  return (Math.atan2(right[1] - left[1], right[0] - left[0]) * 180) / Math.PI;
}

/**
 * 给定人脸与源图尺寸，算出自动构图参数。
 *
 * `crownY` 是分割蒙版前景最高行的像素 y（真实头顶）。YuNet 的人脸框起点在发际线
 * 附近而不是头顶，所以有蒙版时优先用蒙版；蒙版给出的位置明显不合理（落在人脸框中
 * 下部之后）时退回估算。
 *
 * 无人脸时返回 null，调用方应保持原有的居中 crop。
 */
export function suggestIdPhotoLayout(
  face: FaceDetection | null,
  source: { width: number; height: number },
  targetAspect: number,
  crownY?: number
): IdPhotoLayout | null {
  if (
    !face ||
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    return null;
  }
  if (!(targetAspect > 0) || !Number.isFinite(targetAspect)) return null;

  const { width, height } = source;
  const { x, y, width: faceWidth, height: faceHeight } = face.box;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(faceWidth) ||
    !Number.isFinite(faceHeight) ||
    faceWidth <= 0 ||
    faceHeight <= 0
  ) {
    return null;
  }

  // 基准框：源图内符合目标宽高比的最大框
  const sourceRatio = width / height;
  const baseCropWidth =
    sourceRatio >= targetAspect ? height * targetAspect : width;
  const baseCropHeight =
    sourceRatio >= targetAspect ? height : width / targetAspect;

  const zoom = Math.round(
    clamp(
      ((DESIRED_FACE_RATIO * baseCropWidth) / faceWidth) * 100,
      MIN_ZOOM,
      MAX_ZOOM
    )
  );
  const zoomRatio = zoom / 100;
  const cropWidth = baseCropWidth / zoomRatio;
  const cropHeight = baseCropHeight / zoomRatio;

  // 水平：让人脸中心对齐裁剪框中心
  const faceCenterX = x + faceWidth / 2;
  const desiredLeft = faceCenterX - cropWidth / 2;
  // zoom >= 100 保证裁剪框不宽于基准框，而基准框在源图内，故这里直接夹回源图。
  const left = clamp(desiredLeft, 0, Math.max(0, width - cropWidth));

  // 垂直：头顶留出 8% 的空白
  let crown = Math.max(0, y - faceHeight * CROWN_FACE_GAP);
  if (typeof crownY === 'number' && Number.isFinite(crownY)) {
    const plausibleLimit = y + faceHeight * CROWN_PLAUSIBLE_SLACK;
    // 负值或落在人脸框下部之后都视为不可信，忽略并退回发际线估算。
    if (crownY >= 0 && crownY <= plausibleLimit) crown = crownY;
  }
  const desiredTop = crown - cropHeight * TOP_MARGIN_RATIO;
  // zoom >= 100 保证裁剪框不高于基准框，而基准框在源图内，故这里直接夹回源图。
  const top = clamp(desiredTop, 0, Math.max(0, height - cropHeight));

  const offsetX = Math.round(
    clamp(
      ((left + cropWidth / 2 - width / 2) / Math.max(1, width)) * 100,
      -MAX_OFFSET,
      MAX_OFFSET
    )
  );
  const offsetY = Math.round(
    clamp(
      ((top + cropHeight / 2 - height / 2) / Math.max(1, height)) * 100,
      -MAX_OFFSET,
      MAX_OFFSET
    )
  );

  const tilt = eyeTiltDegrees(face.landmarks);
  const rotation =
    Math.abs(tilt) < ROTATION_THRESHOLD
      ? 0
      : clamp(tilt * ROTATION_GAIN, -MAX_ROTATION, MAX_ROTATION);

  return {
    zoom,
    offsetX,
    offsetY,
    rotation,
    faceRatio: faceWidth / Math.max(1, cropWidth),
    // 不能用 crown - top：构图已把 crown 固定在 8%，该差值恒等于
    // TOP_MARGIN_RATIO。改用人脸框上沿到裁剪框上沿的距离，才能区分
    // 「蒙版真实头顶」与「人脸框估算」两种输入。
    faceTopMargin: Math.max(0, (y - top) / Math.max(1, cropHeight)),
  };
}

/**
 * 把自动构图结果换算成服务端契约的 `IdPhotoCrop`。
 *
 * 两套模型描述的是同一个框：`suggestIdPhotoLayout` 用「zoom/offset」，
 * `resolveIdPhotoCropBox` 用「中心 + 相对基准框的放大倍数」。这里做一次换算，
 * 保证自动构图与服务端/本地合成用的是同一个几何函数。
 */
export function idPhotoCropFromLayout(
  layout: IdPhotoLayout,
  source: { width: number; height: number },
  targetAspect: number
): IdPhotoCrop {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new RangeError(
      'idPhotoCropFromLayout: source dimensions must be positive finite numbers'
    );
  }
  if (!(targetAspect > 0) || !Number.isFinite(targetAspect)) {
    throw new RangeError(
      'idPhotoCropFromLayout: targetAspect must be a positive finite number'
    );
  }

  const sourceRatio = source.width / source.height;
  const baseCropWidth =
    sourceRatio >= targetAspect ? source.height * targetAspect : source.width;
  const baseCropHeight =
    sourceRatio >= targetAspect ? source.height : source.width / targetAspect;

  /*
   * IdPhotoCrop 只允许 scale >= 1（裁得比基准框更紧）。suggestIdPhotoLayout
   * 的 zoom 下限是 100，正常情况下这里不会被夹取；但 layout 也可能来自外部
   * 构造，zoom < 100 在服务端契约里无法表达，此时 scale 夹到 1，宽高必须按
   * 「夹取后的 scale」计算，否则 x/y 会指向一个并不存在的框中心。
   */
  const scale = clamp(layout.zoom / 100, 1, 3);
  const cropWidth = baseCropWidth / scale;
  const cropHeight = baseCropHeight / scale;

  // offset 是「裁剪框中心相对源图中心的百分比」，与 suggestIdPhotoLayout 的写入口径一致
  const centerX = source.width / 2 + (layout.offsetX / 100) * source.width;
  const centerY = source.height / 2 + (layout.offsetY / 100) * source.height;

  const left = clamp(
    centerX - cropWidth / 2,
    0,
    Math.max(0, source.width - cropWidth)
  );
  const top = clamp(
    centerY - cropHeight / 2,
    0,
    Math.max(0, source.height - cropHeight)
  );

  return {
    x: (left + cropWidth / 2) / source.width,
    y: (top + cropHeight / 2) / source.height,
    scale,
  };
}

/**
 * 把源图坐标下的人脸框与关键点映射到成片坐标。
 *
 * 渲染链路是 `extract(baseBox) → rotate(-rotation) → resize(cover)`，因此映射分三步：
 * 1. 减去 `baseBox.left/top`，得到裁剪框局部坐标；
 * 2. 按 `preset.widthPx / baseBox.width`、`preset.heightPx / baseBox.height` 缩放；
 * 3. 绕成片中心旋转。sharp 的 `rotate` 正值是顺时针，渲染实际用的是
 *    `rotate(-rotation)`，所以这里同样按 `-rotation` 旋转。
 *
 * `inspectIdPhoto` 用 `box.width / 成片宽度` 算 faceRatio、用 `box.x` 算居中、
 * 用 `box.y` 算头顶留白。若把源图坐标直接传进去，这些比例会全部失真，合格照片
 * 也会被判失败 —— 所以质量检查前必须先做这次映射。
 *
 * 本地 canvas 路与服务端 sharp 路共用这一个函数，保证两端质量结论一致。
 */
export function mapFaceToOutput(
  face: FaceDetection,
  baseBox: IdPhotoCropBox,
  preset: { widthPx: number; heightPx: number },
  rotation: number
): FaceDetection {
  const scaleX = preset.widthPx / Math.max(1, baseBox.width);
  const scaleY = preset.heightPx / Math.max(1, baseBox.height);
  const centerX = preset.widthPx / 2;
  const centerY = preset.heightPx / 2;
  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const mapPoint = (point: readonly [number, number]): [number, number] => {
    const localX = (point[0] - baseBox.left) * scaleX;
    const localY = (point[1] - baseBox.top) * scaleY;
    const dx = localX - centerX;
    const dy = localY - centerY;
    return [centerX + cos * dx - sin * dy, centerY + sin * dx + cos * dy];
  };

  // 旋转后的人脸框仍是轴对齐矩形：把四个角映射过去再取外接矩形。
  const corners = [
    mapPoint([face.box.x, face.box.y]),
    mapPoint([face.box.x + face.box.width, face.box.y]),
    mapPoint([face.box.x, face.box.y + face.box.height]),
    mapPoint([face.box.x + face.box.width, face.box.y + face.box.height]),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    box: {
      x: left,
      y: top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top,
    },
    landmarks: face.landmarks.map(mapPoint),
    score: face.score,
  };
}
