import { describe, expect, it } from 'vitest';
import {
  createHeroWorkbenchClock,
  createWorkbenchLayerConfigs,
  heroWorkbenchMetrics,
} from '../hero-workbench-scene-model';

describe('hero workbench scene model', () => {
  it('describes a balanced set of file-processing layers', () => {
    const layers = createWorkbenchLayerConfigs();

    expect(layers).toHaveLength(7);
    expect(layers.map(layer => layer.label)).toEqual([
      'PDF',
      'IMG',
      'GIF',
      'DOC',
      'TXT',
      'FONT',
      'ZIP',
    ]);
    expect(new Set(layers.map(layer => layer.type))).toEqual(
      new Set(['document', 'image', 'animation', 'archive'])
    );
  });

  it('keeps scene density within the hero viewport budget', () => {
    expect(heroWorkbenchMetrics.fileLayerCount).toBe(7);
    expect(heroWorkbenchMetrics.orbitRadius).toBeGreaterThan(2.2);
    expect(heroWorkbenchMetrics.orbitRadius).toBeLessThan(3.2);
    expect(heroWorkbenchMetrics.cameraDistance).toBeGreaterThan(5);
  });

  it('caps animation time after a long background pause', () => {
    const clock = createHeroWorkbenchClock({ maxFrameDelta: 0.05 });

    expect(clock.tick(1000)).toBe(0);
    expect(clock.tick(1016)).toBeCloseTo(0.016, 3);
    expect(clock.tick(5016)).toBeCloseTo(0.066, 3);
  });

  it('resumes from the current frame time without catching up hidden time', () => {
    const clock = createHeroWorkbenchClock({ maxFrameDelta: 0.05 });

    expect(clock.tick(1000)).toBe(0);
    expect(clock.tick(1020)).toBeCloseTo(0.02, 3);

    clock.reset(9000);

    expect(clock.tick(9000)).toBeCloseTo(0.02, 3);
    expect(clock.tick(9020)).toBeCloseTo(0.04, 3);
  });
});
