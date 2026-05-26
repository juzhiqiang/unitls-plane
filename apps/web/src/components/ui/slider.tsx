import * as React from 'react';
import { cn } from '@/lib/utils';

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ value, min = 0, max = 100, step = 1, onChange, className }, ref) => {
    const percentage = ((value - min) / (max - min)) * 100;

    return (
      <div className={cn('relative flex items-center w-full h-5', className)}>
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="slider-input absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div className="relative w-full h-[1px] bg-border">
          <div
            className="absolute left-0 top-0 h-full bg-accent/40"
            style={{ width: `${percentage}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[10px] h-[10px] rounded-full border-[2px] border-accent bg-background transition-colors"
            style={{ left: `${percentage}%` }}
          />
        </div>
      </div>
    );
  }
);
Slider.displayName = 'Slider';

export { Slider };
