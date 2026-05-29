'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
}

export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(
  function AuthField({ id, label, className, ...props }, ref) {
    return (
      <div className="space-y-1.5">
        <label
          htmlFor={id}
          className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          className={cn(
            'w-full h-10 px-3 bg-transparent border border-border rounded-md text-sm text-foreground',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:border-accent focus:ring-1 focus:ring-ring',
            'transition-colors',
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);
