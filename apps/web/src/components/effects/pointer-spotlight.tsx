'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PointerSpotlightProps {
  children: ReactNode;
  className?: string;
  /** Spotlight diameter in px. */
  radius?: number;
  /** Accent mix percentage at the centre (0–100). */
  intensity?: number;
}

/**
 * Wraps content with a cursor-following accent spotlight. The glow layer sits
 * behind the children (z-0) and is purely decorative. Pointer tracking is
 * rAF-throttled; it degrades gracefully with no pointer (stays hidden).
 */
export function PointerSpotlight({
  children,
  className,
  radius = 520,
  intensity = 12,
}: PointerSpotlightProps) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const x = e.clientX;
    const y = e.clientY;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--spot-x', `${x - rect.left}px`);
      el.style.setProperty('--spot-y', `${y - rect.top}px`);
      el.dataset.active = 'true';
    });
  };

  const handleLeave = () => {
    const el = ref.current;
    if (el) el.dataset.active = 'false';
  };

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={cn('spotlight-host relative', className)}
      style={
        {
          '--spot-radius': `${radius}px`,
          '--spot-intensity': `${intensity}%`,
        } as CSSProperties
      }
    >
      <span aria-hidden className="spotlight-layer" />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
