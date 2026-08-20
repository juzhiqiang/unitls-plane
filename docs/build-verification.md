# 构建验证说明（Windows 开发机 vs Linux）

本文记录一次针对 `bun --cwd apps/web build` 失败的排查结论，避免重复走弯路。

## 结论

**生产构建在 Linux（实际部署目标）下是干净的**；在 Windows 开发机上观察到的失败属于环境问题，不代表代码有问题。

Docker（`oven/bun:1` + `node:22-bookworm-slim`）实测：

- prerender 错误 0 个，静态页 80/80 全部生成；
- Service Worker 与预缓存清单正常产出；
- `output: 'standalone'` 产物完整，含 `server.js` 与 `.next/routes-manifest.json`。

复现命令：

```bash
docker build --target builder \
  --build-arg NEXT_PUBLIC_RELEASE=dev \
  --build-arg NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com \
  -t utils-plane-buildcheck:latest -f Dockerfile .
```

## Windows 上会遇到的两类失败

### 1. `standalone` 输出的 EPERM symlink（确定性）

```
⚠ Failed to copy traced files ... EPERM: operation not permitted, symlink
Error: ENOENT: no such file or directory, copyfile '.next/routes-manifest.json'
      -> '.next/standalone/.next/routes-manifest.json'
```

`output: 'standalone'` 需要创建符号链接，Windows 默认不允许非管理员建 symlink。这会让
`bun run build` 以退出码 1 结束，**即使 prerender 阶段 0 错误**。

要在 Windows 上跑通，需开启「开发者模式」或以管理员运行；否则请以 Docker 构建为准。

判断方法：先看 prerender 错误数，再看退出码。

```bash
grep -c "Error occurred prerendering" build.log
```

### 2. prerender 阶段的偶发 chunk 错误（非确定性）

```
TypeError: Cannot read properties of undefined (reading 'call')
    at Object.t [as require] (.next/server/webpack-runtime.js:1:128)
```

实测在**同一份代码、同一份配置**下，多次干净构建的结果并不一致（出现过 21 个失败页，也出现过连续三次 0 失败）。因此它不能用来判定某次代码改动是否引入了回归。

排查时踩过的两个坑，记录下来：

- **不要用增量构建验证构建修复。** 若上一次构建带着不同配置（例如 `DISABLE_PWA=true`）跑过，`.next`
  里的产物会被复用，导致"修复生效"的假象。验证前必须确认 `.next` 已被完全删除 —— Windows 上
  `rm -rf .next` 可能因文件锁部分失败并报
  `Directory not empty`，残留的目录本身就会引发同一个 chunk 错误。

  ```bash
  for i in 1 2 3; do rm -rf .next 2>/dev/null; [ ! -e .next ] && break; sleep 3; done
  [ -e .next ] && echo "未删净，不要据此判断"
  ```

- **不要据单次结果归因。** 曾先后把该失败归因于
  `@huggingface/transformers`、next-pwa 介入 server 编译、以及
  `aggressiveFrontEndNavCaching`，最终都被「同状态同配置跑出相反结果」推翻。

## 与 next.config.mjs 的关系

`next.config.mjs` 现在把配置拆成 `intlConfig`（不含 PWA）与
`pwaConfig`（含），webpack 钩子按 server/client 取用不同层级，使 next-pwa 不介入 server 编译。

该改动本身是合理的（Service
Worker 只对 client 有意义），且已随上述 Docker 构建一并验证可用；但它**并不是**上述偶发失败的原因 —— 引入它的那次提交 (`fix(web): 修复生产构建 prerender 失败`) 中的因果结论应视为存疑。

## 建议

- 发版前的构建验收以 Docker/Linux 为准；
- Windows 上日常用 `bun --cwd apps/web test` 与 `bun --cwd apps/web run lint`
  即可，需要跑构建时以 prerender 错误数而非退出码作为主要信号。
