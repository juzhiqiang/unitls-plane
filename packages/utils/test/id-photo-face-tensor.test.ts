import { describe, expect, it } from 'bun:test';
import {
  YUNET_INPUT_SIZE,
  parseYunetOutput,
  scaleDetectedFaces,
} from '../src/id-photo-face-tensor';

function makeRow(
  x: number,
  y: number,
  w: number,
  h: number,
  score: number
): number[] {
  return [
    x,
    y,
    w,
    h,
    // 5 个关键点
    x + w * 0.3,
    y + h * 0.4,
    x + w * 0.7,
    y + h * 0.4,
    x + w * 0.5,
    y + h * 0.55,
    x + w * 0.35,
    y + h * 0.75,
    x + w * 0.65,
    y + h * 0.75,
    score,
  ];
}

describe('parseYunetOutput', () => {
  it('exposes the 320px default input size', () => {
    expect(YUNET_INPUT_SIZE).toBe(320);
  });

  it('parses a single confident face', () => {
    const faces = parseYunetOutput(makeRow(10, 20, 60, 80, 0.9), 15);
    expect(faces.length).toBe(1);
    expect(faces[0]!.box.x).toBe(10);
    expect(faces[0]!.box.width).toBe(60);
    expect(faces[0]!.score).toBeCloseTo(0.9, 5);
    expect(faces[0]!.landmarks.length).toBe(5);
  });

  it('sorts by score descending', () => {
    const values = [
      ...makeRow(0, 0, 40, 40, 0.4),
      ...makeRow(50, 50, 40, 40, 0.95),
    ];
    const faces = parseYunetOutput(values, 15, 0.3);
    expect(faces.length).toBe(2);
    expect(faces[0]!.score).toBeCloseTo(0.95, 5);
  });

  it('drops rows below the confidence threshold', () => {
    const values = [
      ...makeRow(0, 0, 40, 40, 0.2),
      ...makeRow(50, 50, 40, 40, 0.9),
    ];
    const faces = parseYunetOutput(values, 15, 0.6);
    expect(faces.length).toBe(1);
    expect(faces[0]!.score).toBeCloseTo(0.9, 5);
  });

  it('ignores trailing padding rows', () => {
    const values = [...makeRow(10, 10, 40, 40, 0.9)];
    // 补一个全 0 的行（YuNet 用 0 填充未使用的 anchor）
    values.push(...new Array(15).fill(0));
    const faces = parseYunetOutput(values, 15);
    expect(faces.length).toBe(1);
  });

  it('returns an empty array for empty input', () => {
    expect(parseYunetOutput([], 15)).toEqual([]);
  });

  it('keeps a row whose score equals the threshold', () => {
    const faces = parseYunetOutput(makeRow(0, 0, 40, 40, 0.6), 15, 0.6);
    expect(faces.length).toBe(1);
  });

  it('ignores a trailing partial row', () => {
    const values = [...makeRow(10, 10, 40, 40, 0.9), 1, 2, 3];
    expect(parseYunetOutput(values, 15).length).toBe(1);
  });

  it('rejects a stride smaller than the 15-value row', () => {
    expect(() => parseYunetOutput([], 14)).toThrow(/stride/);
  });
});

describe('scaleDetectedFaces', () => {
  it('subtracts the letterbox offset before scaling back to source space', () => {
    const faces = parseYunetOutput(makeRow(50, 70, 100, 120, 0.9), 15);
    const [scaled] = scaleDetectedFaces(faces, {
      scaleX: 2,
      scaleY: 4,
      offsetX: 10,
      offsetY: 20,
    });

    expect(scaled!.box).toEqual({ x: 80, y: 200, width: 200, height: 480 });
    // 关键点同样先减 offset 再乘比例
    expect(scaled!.landmarks[0]!).toEqual([(80 - 10) * 2, (118 - 20) * 4]);
  });

  it('defaults offsets to zero', () => {
    const faces = parseYunetOutput(makeRow(10, 20, 60, 80, 0.9), 15);
    const [scaled] = scaleDetectedFaces(faces, { scaleX: 0.5, scaleY: 0.5 });

    expect(scaled!.box).toEqual({ x: 5, y: 10, width: 30, height: 40 });
  });
});
