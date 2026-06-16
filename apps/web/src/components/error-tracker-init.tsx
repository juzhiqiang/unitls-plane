'use client';

import { useEffect } from 'react';
import { init, getClient } from '@error-tracker/sdk';
import { ReplayPlugin } from '@error-tracker/sdk/plugins/replay';

let initialized = false;

const FLUSH_INTERVAL_MS = 10_000; // 每 10 秒主动上报一次

export function ErrorTrackerInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_ERROR_TRACKER_DSN;
    if (!dsn) return;

    if (!initialized) {
      initialized = true;
      init({
        dsn,
        token: '799633a3c059761279885e6ae53f8e1e971dc342',
        environment: process.env.NODE_ENV,
        release: process.env.NEXT_PUBLIC_RELEASE ?? 'dev',
        integrations: [
          new ReplayPlugin({ bufferSeconds: 30, sampleRate: 0.5 }),
        ],
      });
    }

    // SDK 的 EventQueue 只在页面关闭时 flush，需要手动定时上报
    const timer = setInterval(() => {
      getClient()?.flush();
    }, FLUSH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return null;
}
