'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface BrandMarkProps
  extends Omit<React.SVGProps<SVGSVGElement>, 'title'> {
  title?: string;
}

export function BrandMark({
  className,
  title = 'Utils Plane logo',
  ...props
}: BrandMarkProps) {
  const reactId = React.useId().replace(/:/g, '');
  const glassId = `utils-plane-glass-${reactId}`;
  const routeId = `utils-plane-route-${reactId}`;
  const shadowId = `utils-plane-shadow-${reactId}`;

  return (
    <svg
      viewBox="0 0 240 240"
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn('block shrink-0', className)}
      {...props}
    >
      <defs>
        <linearGradient
          id={routeId}
          x1="55"
          y1="170"
          x2="180"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="0.46" stopColor="#d4d4d8" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <linearGradient
          id={glassId}
          x1="60"
          y1="44"
          x2="182"
          y2="190"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#2a2b31" />
          <stop offset="1" stopColor="#090a0d" />
        </linearGradient>
        <filter
          id={shadowId}
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow
            dx="0"
            dy="12"
            stdDeviation="14"
            floodColor="#000000"
            floodOpacity="0.38"
          />
        </filter>
      </defs>
      <rect
        x="38"
        y="38"
        width="164"
        height="164"
        rx="40"
        fill={`url(#${glassId})`}
        stroke="#ffffff"
        strokeOpacity="0.16"
        strokeWidth="1.6"
        filter={`url(#${shadowId})`}
      />
      <path
        d="M67 141c35-29 69-30 102-4"
        fill="none"
        stroke={`url(#${routeId})`}
        strokeWidth="18"
        strokeLinecap="round"
      />
      <path
        d="M69 165c34-11 66-8 96 10"
        fill="none"
        stroke="#ffffff"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.34"
      />
      <path
        d="M120 62l8.5 26.5L155 97l-26.5 8.5L120 132l-8.5-26.5L85 97l26.5-8.5L120 62z"
        fill="#f5f5f7"
      />
      <path
        d="M120 82l4 11.5L136 97l-12 4-4 12-4-12-12-4 12-3.5L120 82z"
        fill="#0a0a0c"
        opacity="0.88"
      />
      <circle cx="166" cy="78" r="2.4" fill="#f5f5f7" opacity="0.7" />
    </svg>
  );
}
