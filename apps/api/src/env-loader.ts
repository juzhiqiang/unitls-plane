import * as path from 'node:path';
import * as dotenv from 'dotenv';

/**
 * 启动时自动加载仓库根目录的 .env.local / .env。
 *
 * - 必须作为第一个 import:dotenv 只在模块求值时跑一次,后续 import 的模块
 *   (NestJS 组件、脚本)都在它之后求值,env 读取发生在运行期,天然可见;
 * - dotenv 默认不覆盖已存在的进程变量:显式 export 的 shell 环境永远优先,
 *   这也意味着「先 source 旧值再启动」会把文件里的新值遮蔽掉 —— 开发态
 *   直接 `bun run dev` 即可,不要再 source .env.local;
 * - dist/容器里没有这两个文件时是 no-op,不影响生产部署。
 *
 * __dirname 在 bun 直跑 ts 与 nest build 的 cjs 产物里都存在:
 * src/ 与 dist/ 都在 apps/api 下,向上三级即仓库根。
 */
const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, '.env') });
