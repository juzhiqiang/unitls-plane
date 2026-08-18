import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e 下是 Playwright 用例(@playwright/test),不应被 vitest 收集;
    // 在默认排除项之外追加 e2e/**。
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
