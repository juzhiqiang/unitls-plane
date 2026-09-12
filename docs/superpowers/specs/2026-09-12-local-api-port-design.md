# 本地 API 端口恢复为 3001 设计

## 目标

将本地开发环境的 API 监听端口从 `3003` 恢复为项目约定的 `3001`，Web 继续监听 `3000`。

## 方案

修改项目根目录、不受 Git 跟踪的 `.env.local`，将 `PORT=3003` 改为 `PORT=3001`。不修改应用代码、`.env.example` 或生产配置，因为这些位置已经使用正确端口。

## 执行与验证

1. 停止当前开发服务。
2. 确认并释放 `3000` 与 `3001` 的旧监听进程。
3. 更新 `.env.local`。
4. 运行 `bun run dev`。
5. 验证 Web `http://localhost:3000` 返回 HTTP 200。
6. 验证 API `http://localhost:3001/health/live` 返回 HTTP 200。

如果 `3001` 再次被 VS Code Insiders 端口转发占用，则终止该转发进程后重新启动服务。
