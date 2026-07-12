export type WorkbenchLayerType = 'archive' | 'animation' | 'document' | 'image';

export interface WorkbenchLayerConfig {
  label: string;
  type: WorkbenchLayerType;
  hue: number;
  phase: number;
}

export const heroWorkbenchMetrics = {
  fileLayerCount: 7,
  orbitRadius: 2.72,
  cameraDistance: 6.4,
} as const;

interface HeroWorkbenchClockOptions {
  maxFrameDelta?: number;
}

export function createHeroWorkbenchClock(
  options: HeroWorkbenchClockOptions = {}
) {
  const maxFrameDelta = options.maxFrameDelta ?? 0.05;
  let previousFrameTime: number | null = null;
  let elapsed = 0;

  return {
    tick(now: number) {
      if (previousFrameTime === null) {
        previousFrameTime = now;
        return elapsed;
      }

      const delta = Math.max(0, (now - previousFrameTime) / 1000);
      previousFrameTime = now;
      elapsed += Math.min(delta, maxFrameDelta);
      return elapsed;
    },
    reset(now: number) {
      previousFrameTime = now;
    },
  };
}

export function createWorkbenchLayerConfigs(): WorkbenchLayerConfig[] {
  return [
    { label: 'PDF', type: 'document', hue: 145, phase: 0 },
    { label: 'IMG', type: 'image', hue: 190, phase: 0.85 },
    { label: 'GIF', type: 'animation', hue: 110, phase: 1.7 },
    { label: 'DOC', type: 'document', hue: 52, phase: 2.55 },
    { label: 'TXT', type: 'document', hue: 220, phase: 3.4 },
    { label: 'FONT', type: 'document', hue: 282, phase: 4.25 },
    { label: 'ZIP', type: 'archive', hue: 28, phase: 5.1 },
  ];
}
