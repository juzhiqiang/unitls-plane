import { describe, expect, it } from 'bun:test';
import {
  applyMatrix,
  arcSweepDeg,
  arcToBulge,
  asAxisAlignedRect,
  concatMatrix,
  dedupeVertices,
  fitArcFromBezier,
  flattenCubicBezier,
  matrixExpansion,
  matrixRotationDeg,
  normalizeAngleDeg,
  pageToCadMatrix,
  round,
  toCounterClockwiseArc,
} from '../../../../../src/modules/tasks/services/cad/geometry';

const KAPPA = 0.5522847498;

describe('pageToCadMatrix', () => {
  it('flips the Y axis around the page height and applies unit × scale', () => {
    // 200pt 高的页面,PDF 左上原点 (10, 10) → CAD 左下原点 (10, 190),再换算到 mm。
    const matrix = pageToCadMatrix(200, 25.4 / 72, 1);
    const point = applyMatrix(matrix, 10, 10);
    expect(point.x).toBeCloseTo((10 * 25.4) / 72, 6);
    expect(point.y).toBeCloseTo((190 * 25.4) / 72, 6);
  });

  it('applies scale after the unit conversion', () => {
    const inch = pageToCadMatrix(72, 1 / 72, 2);
    const point = applyMatrix(inch, 72, 0);
    expect(point.x).toBeCloseTo(2, 6);
    expect(point.y).toBeCloseTo(2, 6);
  });
});

describe('concatMatrix', () => {
  it('matches MuPDF semantics: apply the first matrix, then the second', () => {
    const translate: [number, number, number, number, number, number] = [
      1, 0, 0, 1, 5, 7,
    ];
    const scale: [number, number, number, number, number, number] = [
      2, 0, 0, 2, 0, 0,
    ];
    const combined = concatMatrix(translate, scale);
    expect(applyMatrix(combined, 1, 1)).toEqual({ x: 12, y: 16 });
    expect(matrixExpansion(combined)).toBeCloseTo(2, 9);
  });

  it('reports the rotation of the x axis in degrees', () => {
    expect(matrixRotationDeg([0, 1, -1, 0, 0, 0])).toBeCloseTo(90, 6);
    expect(matrixRotationDeg([1, 0, 0, -1, 0, 0])).toBe(0);
    expect(normalizeAngleDeg(-90)).toBe(270);
    expect(normalizeAngleDeg(720)).toBe(0);
  });
});

describe('fitArcFromBezier', () => {
  it('recognises the standard quarter-circle bezier as a 90° arc', () => {
    const r = 30;
    const arc = fitArcFromBezier(
      {
        p0: { x: r, y: 0 },
        p1: { x: r, y: r * KAPPA },
        p2: { x: r * KAPPA, y: r },
        p3: { x: 0, y: r },
      },
      0.05
    );
    expect(arc).not.toBeNull();
    expect(arc!.center.x).toBeCloseTo(0, 3);
    expect(arc!.center.y).toBeCloseTo(0, 3);
    expect(arc!.radius).toBeCloseTo(r, 3);
    expect(arc!.counterClockwise).toBe(true);
    expect(arcSweepDeg(arc!)).toBeCloseTo(90, 3);
    const ccw = toCounterClockwiseArc(arc!);
    expect(ccw.startAngle).toBeCloseTo(0, 6);
    expect(ccw.endAngle).toBeCloseTo(90, 6);
    expect(arcToBulge(arc!)).toBeCloseTo(Math.tan(Math.PI / 8), 6);
  });

  it('flips angles for clockwise arcs', () => {
    const r = 10;
    const arc = fitArcFromBezier(
      {
        p0: { x: 0, y: r },
        p1: { x: r * KAPPA, y: r },
        p2: { x: r, y: r * KAPPA },
        p3: { x: r, y: 0 },
      },
      0.05
    );
    expect(arc!.counterClockwise).toBe(false);
    const ccw = toCounterClockwiseArc(arc!);
    expect(ccw.startAngle).toBeCloseTo(0, 6);
    expect(ccw.endAngle).toBeCloseTo(90, 6);
    expect(arcToBulge(arc!)).toBeLessThan(0);
  });

  it('rejects an S-shaped curve that is not circular', () => {
    const arc = fitArcFromBezier(
      {
        p0: { x: 0, y: 0 },
        p1: { x: 30, y: 40 },
        p2: { x: 60, y: -40 },
        p3: { x: 90, y: 0 },
      },
      0.05
    );
    expect(arc).toBeNull();
  });

  it('flattens rejected curves into a bounded polyline ending at p3', () => {
    const points = flattenCubicBezier(
      {
        p0: { x: 0, y: 0 },
        p1: { x: 30, y: 40 },
        p2: { x: 60, y: -40 },
        p3: { x: 90, y: 0 },
      },
      0.1
    );
    expect(points.length).toBeGreaterThan(2);
    expect(points.length).toBeLessThanOrEqual(64);
    expect(points[points.length - 1]).toEqual({ x: 90, y: 0 });
  });
});

describe('vertex helpers', () => {
  it('drops consecutive duplicate vertices within epsilon', () => {
    const vertices = dedupeVertices(
      [
        { x: 0, y: 0 },
        { x: 0.001, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 0.004 },
      ],
      0.01
    );
    expect(vertices).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('detects axis-aligned rectangles and rejects skewed quads', () => {
    expect(
      asAxisAlignedRect(
        [
          { x: 1, y: 1 },
          { x: 9, y: 1 },
          { x: 9, y: 3 },
          { x: 1, y: 3 },
          { x: 1, y: 1 },
        ],
        0.01
      )
    ).toEqual({ minX: 1, minY: 1, maxX: 9, maxY: 3 });
    expect(
      asAxisAlignedRect(
        [
          { x: 0, y: 0 },
          { x: 9, y: 1 },
          { x: 9, y: 3 },
          { x: 1, y: 3 },
        ],
        0.01
      )
    ).toBeNull();
  });

  it('rounds without producing negative zero', () => {
    expect(Object.is(round(-0.0000001), 0)).toBe(true);
    expect(round(1.23456789)).toBe(1.234568);
  });
});
