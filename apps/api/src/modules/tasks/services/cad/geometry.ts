import type { CadPoint, CadPolylineVertex } from './types';

/**
 * PDF 转 CAD 的纯几何工具:仿射变换、坐标翻转、贝塞尔拟合与折线化、圆弧/圆识别。
 * 全部是无副作用的数值函数,便于单独测试;不依赖 MuPDF。
 */

/** MuPDF 风格 2×3 仿射矩阵 [a, b, c, d, e, f]:x' = a·x + c·y + e,y' = b·x + d·y + f。 */
export type AffineMatrix = [number, number, number, number, number, number];

export const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 1, 0, 0];

export function applyMatrix(m: AffineMatrix, x: number, y: number): CadPoint {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

/** one 后接 two(先 one 再 two),与 MuPDF `Matrix.concat` 语义一致。 */
export function concatMatrix(
  one: AffineMatrix,
  two: AffineMatrix
): AffineMatrix {
  return [
    one[0] * two[0] + one[1] * two[2],
    one[0] * two[1] + one[1] * two[3],
    one[2] * two[0] + one[3] * two[2],
    one[2] * two[1] + one[3] * two[3],
    one[4] * two[0] + one[5] * two[2] + two[4],
    one[4] * two[1] + one[5] * two[3] + two[5],
  ];
}

/** 矩阵的等比缩放量(几何平均),用于线宽、字号等标量的换算。 */
export function matrixExpansion(m: AffineMatrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** 矩阵 x 轴方向的旋转角(度,数学正方向)。 */
export function matrixRotationDeg(m: AffineMatrix): number {
  return normalizeAngleDeg((Math.atan2(m[1], m[0]) * 180) / Math.PI);
}

export function normalizeAngleDeg(angle: number): number {
  let value = angle % 360;
  if (value < 0) value += 360;
  // -0 → 0,避免输出 "-0"
  return value === 0 ? 0 : value;
}

/**
 * 把 PDF 页面坐标(左上原点、point、y 向下)映射到 CAD 坐标(左下原点、目标单位、y 向上)。
 *
 * 矩阵形式:x' = x·k,y' = (H − y)·k,k = unitFactor × scale。
 * 与 MuPDF 页面 ctm 串联后,一次矩阵乘法完成翻转 + 单位换算 + 比例。
 */
export function pageToCadMatrix(
  pageHeightPt: number,
  unitFactor: number,
  scale: number
): AffineMatrix {
  const k = unitFactor * scale;
  return [k, 0, 0, -k, 0, pageHeightPt * k];
}

export function distance(a: CadPoint, b: CadPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function nearlyEqual(a: number, b: number, epsilon: number): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function pointsNearlyEqual(
  a: CadPoint,
  b: CadPoint,
  epsilon: number
): boolean {
  return nearlyEqual(a.x, b.x, epsilon) && nearlyEqual(a.y, b.y, epsilon);
}

/** 保留 6 位小数并去掉 -0:DXF 文本里的数字要稳定可比。 */
export function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function roundPoint(point: CadPoint, digits = 6): CadPoint {
  return { x: round(point.x, digits), y: round(point.y, digits) };
}

export interface CubicBezier {
  p0: CadPoint;
  p1: CadPoint;
  p2: CadPoint;
  p3: CadPoint;
}

export function bezierPoint(curve: CubicBezier, t: number): CadPoint {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x,
    y: a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y,
  };
}

/**
 * 三次贝塞尔按弦高容差打散成折线(不含起点,含终点)。
 * 分段数由控制多边形长度与容差估算,并夹在 [1, 64],保证输出确定且有界。
 */
export function flattenCubicBezier(
  curve: CubicBezier,
  tolerance: number
): CadPoint[] {
  const hull =
    distance(curve.p0, curve.p1) +
    distance(curve.p1, curve.p2) +
    distance(curve.p2, curve.p3);
  if (hull === 0) return [curve.p3];
  const segments = Math.min(
    64,
    Math.max(1, Math.ceil(Math.sqrt(hull / Math.max(tolerance, 1e-9)) * 0.75))
  );
  const points: CadPoint[] = [];
  for (let i = 1; i <= segments; i++) {
    points.push(bezierPoint(curve, i / segments));
  }
  return points;
}

export interface FittedArc {
  center: CadPoint;
  radius: number;
  /** 度,逆时针(数学正方向)。 */
  startAngle: number;
  endAngle: number;
  /** 起点到终点是否逆时针走向。 */
  counterClockwise: boolean;
}

/**
 * 判断一段三次贝塞尔是否是圆弧的标准近似(PDF 里几乎所有圆/圆角都由 kappa≈0.5523 的贝塞尔画成)。
 *
 * 判据:起点/终点切线的交点决定圆心候选;沿曲线取样,各样点到圆心的距离与半径偏差在容差内。
 * 返回 null 表示不是圆弧,调用方回退到折线。
 */
export function fitArcFromBezier(
  curve: CubicBezier,
  tolerance: number
): FittedArc | null {
  const { p0, p1, p2, p3 } = curve;
  const chord = distance(p0, p3);
  if (chord < 1e-9) return null;

  // 起点切线方向 t0 = p1 - p0,终点切线方向 t1 = p3 - p2;法线各自旋转 90°,求交点即圆心。
  const t0 = { x: p1.x - p0.x, y: p1.y - p0.y };
  const t1 = { x: p3.x - p2.x, y: p3.y - p2.y };
  if (Math.hypot(t0.x, t0.y) < 1e-9 || Math.hypot(t1.x, t1.y) < 1e-9) {
    return null;
  }
  const n0 = { x: -t0.y, y: t0.x };
  const n1 = { x: -t1.y, y: t1.x };
  const det = n0.x * n1.y - n0.y * n1.x;
  if (Math.abs(det) < 1e-12) return null;

  // p0 + s·n0 = p3 + u·n1
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const s = (dx * n1.y - dy * n1.x) / det;
  const center = { x: p0.x + s * n0.x, y: p0.y + s * n0.y };
  const radius = distance(center, p0);
  if (radius < 1e-9 || !Number.isFinite(radius)) return null;
  if (!nearlyEqual(distance(center, p3), radius, tolerance)) return null;

  for (const t of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
    const sample = bezierPoint(curve, t);
    if (!nearlyEqual(distance(center, sample), radius, tolerance)) return null;
  }

  const startAngle = normalizeAngleDeg(
    (Math.atan2(p0.y - center.y, p0.x - center.x) * 180) / Math.PI
  );
  const endAngle = normalizeAngleDeg(
    (Math.atan2(p3.y - center.y, p3.x - center.x) * 180) / Math.PI
  );
  // 叉积符号给出走向:>0 逆时针。
  const cross =
    (p0.x - center.x) * (p3.y - center.y) -
    (p0.y - center.y) * (p3.x - center.x);
  // 半圆及以上单段贝塞尔近似不准,常规 PDF 不会这样画;这里用中点侧判断方向更稳。
  const mid = bezierPoint(curve, 0.5);
  const crossMid =
    (p0.x - center.x) * (mid.y - center.y) -
    (p0.y - center.y) * (mid.x - center.x);
  const counterClockwise = (Math.abs(cross) > 1e-9 ? cross : crossMid) > 0;

  return { center, radius, startAngle, endAngle, counterClockwise };
}

/** 弧的扫过角度(度,0~360),按给定走向。 */
export function arcSweepDeg(arc: FittedArc): number {
  const sweep = arc.counterClockwise
    ? normalizeAngleDeg(arc.endAngle - arc.startAngle)
    : normalizeAngleDeg(arc.startAngle - arc.endAngle);
  return sweep === 0 ? 360 : sweep;
}

/**
 * 把弧写成 CAD 习惯的逆时针 start→end。顺时针弧交换端点即可。
 */
export function toCounterClockwiseArc(arc: FittedArc): {
  startAngle: number;
  endAngle: number;
} {
  return arc.counterClockwise
    ? { startAngle: arc.startAngle, endAngle: arc.endAngle }
    : { startAngle: arc.endAngle, endAngle: arc.startAngle };
}

/** LWPOLYLINE 顶点凸度:bulge = tan(sweep/4),逆时针为正。 */
export function arcToBulge(arc: FittedArc): number {
  const sweepRad = (arcSweepDeg(arc) * Math.PI) / 180;
  const bulge = Math.tan(sweepRad / 4);
  return arc.counterClockwise ? bulge : -bulge;
}

/** 折线顶点去重:连续重复点(容差内)只保留一个。 */
export function dedupeVertices<T extends CadPoint>(
  vertices: T[],
  epsilon: number
): T[] {
  const result: T[] = [];
  for (const vertex of vertices) {
    const last = result[result.length - 1];
    if (last && pointsNearlyEqual(last, vertex, epsilon)) {
      // 保留后者的 bulge(如果前者是 0 而后者有值)
      if ('bulge' in vertex && (vertex as CadPolylineVertex).bulge) {
        (last as CadPolylineVertex).bulge = (vertex as CadPolylineVertex).bulge;
      }
      continue;
    }
    result.push(vertex);
  }
  return result;
}

export interface AxisAlignedRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 四个(或首尾重合的五个)顶点是否构成轴对齐矩形。是则返回边界,否则 null。
 */
export function asAxisAlignedRect(
  vertices: CadPoint[],
  epsilon: number
): AxisAlignedRect | null {
  let points = vertices;
  if (
    points.length === 5 &&
    pointsNearlyEqual(points[0]!, points[4]!, epsilon)
  ) {
    points = points.slice(0, 4);
  }
  if (points.length !== 4) return null;

  for (let i = 0; i < 4; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % 4]!;
    const horizontal = nearlyEqual(a.y, b.y, epsilon);
    const vertical = nearlyEqual(a.x, b.x, epsilon);
    if (horizontal === vertical) return null; // 既不水平也不竖直,或退化为点
  }
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function boundsOfPoints(points: CadPoint[]): AxisAlignedRect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

/** 0~1 浮点分量 → 0~255 整数。 */
export function toByte(component: number): number {
  return Math.max(0, Math.min(255, Math.round(component * 255)));
}
