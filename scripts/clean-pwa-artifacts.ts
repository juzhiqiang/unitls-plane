/**
 * 清理 @ducanh2912/next-pwa 在 apps/web/public 下生成的构建产物。
 *
 * next-pwa 10.x 在 webpack 钩子里先扫描 public/**\/* 生成预缓存清单、之后才删除
 * 旧产物再写新文件:上一次构建遗留的 hash 命名产物(sw.js / workbox-*.js /
 * fallback-*.js / swe-worker-*.js)会被写进清单,却在新构建里以不同 hash 重生,
 * 导致清单引用不存在的文件、child compiler 的 chunk 图被污染,server 编译的
 * webpack runtime 在 prerender 时报 "Cannot read properties of undefined
 * (reading 'call')"。构建前清掉这些产物即可避免。
 *
 * 用法:在 apps/web 的 build 脚本里先执行本文件(next build 之前)。
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = join(import.meta.dir, '../apps/web/public');
const stalePatterns: RegExp[] = [
  /^sw\.js(\.map)?$/,
  /^workbox-[^/]+\.js(\.map)?$/,
  /^fallback-[^/]+\.js(\.map)?$/,
  /^swe-worker-[^/]+\.js(\.map)?$/,
  /^worker-[^/]+\.js(\.map)?$/,
];

let removed = 0;
try {
  for (const name of readdirSync(publicDir)) {
    if (stalePatterns.some(pattern => pattern.test(name))) {
      rmSync(join(publicDir, name), { force: true });
      removed++;
    }
  }
} catch {
  // public 目录不存在时静默跳过
}
console.log(`[clean-pwa-artifacts] removed ${removed} stale PWA artifact(s)`);
