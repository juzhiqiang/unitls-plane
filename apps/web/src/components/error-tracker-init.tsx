'use client';

import { useEffect } from 'react';
import { init } from '@error-tracker/sdk';
import { ReplayPlugin } from '@error-tracker/sdk/plugins/replay';

let initialized = false;

export function ErrorTrackerInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN;
    if (!dsn) return;

    if (!initialized) {
      initialized = true;
      const token = process.env.NEXT_PUBLIC_ERROR_TRACKER_TOKEN;
      init({
        dsn,
        ...(token ? { token } : {}),
        environment: process.env.NODE_ENV,
        release: process.env.NEXT_PUBLIC_RELEASE ?? 'dev',
        integrations: [
          new ReplayPlugin({ bufferSeconds: 30, sampleRate: 0.5 }),
        ],
      });
    }
  }, []);

  return null;
}
