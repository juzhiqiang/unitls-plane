---
name: frontend-performance-analysis
description: Use when a web UI feels slow or janky — 页面卡死掉帧、交互无响应、主线程被长任务阻塞、首屏/加载慢、bundle 过大、内存涨或标签页崩溃、本地图片/视频/文件处理卡 UI、performance/slow/jank/freeze/memory leak;涉及主线程 vs Web Worker、Canvas/OffscreenCanvas、wasm/WebGPU、大 chunk 或重渲染。技术层通用,末尾附本项目落点。
---

# 前端性能问题分析

## 概览

**核心原则:没有测量数据不许优化;先定位是哪一层慢,再单变量验证。**

前端性能几乎都是「层」的问题。改任何东西前,先确定卡顿/内存落在下面哪一层,只对最慢的那一层动手:

网络/加载 → bundle 解析执行 → 主线程 vs Web Worker(重活跑哪儿)→ 渲染/布局/重绘 → 内存/GC。

猜「这里肯定卡」然后直接改,是失败。先量,再定位,再验证。

## 测量优先

1. **复现并量化**:卡多久?每次都卡还是偶发?输入多大(图片数、分辨率、帧数、列表条数)?什么设备/浏览器?
2. **分层加证据**,一层一个手段:
   - 主线程:DevTools Performance 录一段,看火焰图和 Long Tasks(>50ms);重活是否阻塞了交互。
   - 重活位置:确认 CPU 密集处理是否真在 Web Worker 里跑,还是回退到了主线程。
   - 加载:Network 面板 + Coverage 看 chunk 大小和未用代码;Lighthouse 看 LCP/TBT/CLS。
   - 内存:Memory 面板 heap snapshot / 时间线,反复操作后是否只增不降(泄漏)。
   - 渲染:Performance 里的 layout/paint,是否有强制同步布局或大面积重绘。
3. **只往最慢的单一层里查**,不要同时改多处。

## 分层症状对照表(通用)

| 症状 | 可能瓶颈层 | 检查方式 | 常见根因 / 修复方向 |
|---|---|---|---|
| 处理时页面卡死、交互无响应 | 重活跑在主线程 | Performance 长任务;查是否在 Worker | CPU 密集(图片/视频/编解码)应进 Web Worker;确认 Worker 真的启用,没有静默回退主线程 |
| Worker 应该生效却仍卡 | Worker 前提不满足回退 | 查 `OffscreenCanvas` / 特性检测是否通过 | 缺 OffscreenCanvas / SharedArrayBuffer 时回退主线程;检测失败要有可见提示而非静默降级 |
| wasm/GPU 任务某些环境极慢 | 加速路径回退 CPU/wasm | 查是否命中 WebGPU/SIMD 还是纯 wasm 兜底 | 无 WebGPU 回退 wasm、无 SIMD 更慢;按能力分档,重活给出耗时预期 |
| 首屏慢、加载久 | bundle 过大 / 未拆分 | Coverage + Network 看大 chunk 和未用代码 | 大依赖没懒加载;路由级 code split、交互时再 import 重库 |
| 长列表滚动掉帧 | 一次渲染过多节点 | Performance 看 scroll 期 layout/paint | 全量渲染 + 每项重排;虚拟化/窗口化,离屏释放 |
| 反复操作后越来越卡、标签崩溃 | 内存泄漏 | heap snapshot 对比,只增不降 | 未释放的 canvas/ImageData/事件监听/大对象;用完释放,离窗回收 |
| 输入时明显卡顿 | 重渲染 / 强制同步布局 | Performance 看 render 次数与 reflow | 无节流的高频更新、读写布局交错;节流 + 批量读写 |

## 假设与单变量验证

- 一次只改一个变量。改前记下 baseline 数字(耗时、TBT、内存峰值),改后对比**同一**指标。
- 没提升就回滚,别在上面叠加第二个改动。
- 拿不准就说「我不确定哪层慢」,回去补测量,不要硬猜。

## 红旗——停下来重新测量

- 「这里肯定卡」但没有 Performance 录制或数字
- 一次改多处 / 同时改 Worker 又改渲染
- 只在高端机测就下结论(低端机才暴露主线程阻塞)
- 拿 dev 模式(未压缩、无 tree-shake)当性能数据
- 为一个还没测出来的瓶颈提前加缓存/Worker/虚拟化

## 验证清单

声明「性能已改善」前必须确认:

- [ ] 有改前 / 改后的**同指标**数字(耗时 / TBT / 内存峰值),复现场景一致
- [ ] 相关测试通过,没引入功能回归
- [ ] 在偏弱设备或节流 CPU 下也确认过,不是只在高端机好看
- [ ] 改的是最慢的那一层,不是顺手动了别处

---

## 本项目落点(Utils-Plane;搬到其它项目可删除本节)

技术栈:Next.js 14 App Router + React 18、Web Worker + OffscreenCanvas、gifenc/upng-js、`@huggingface/transformers`(WebGPU/wasm)。本地优先工具尽量在浏览器完成,重活走 Worker。无遥测,测量只靠 DevTools Performance/Memory、Lighthouse。

| 通用症状 | 本项目具体位置 |
|---|---|
| 重活回退主线程 | `apps/web/src/lib/processing/image-worker-client.ts` 的 `runInImageWorker` 无 `OffscreenCanvas` 时回退主线程;Worker 入口 `image.worker.ts`,主/Worker 共用 `canvas-surface.ts` |
| 最重的本地工作负载 | GIF/APNG `apps/web/src/lib/processing/image-animation-client.ts`(gifenc 量化 + upng 编码,逐帧 `getImageData`/`putImageData`);长图拼接 `image-stitch-client.ts`(64 MiB 有界解码缓存) |
| wasm 回退极重 | 抠图 `apps/web/src/lib/id-photo-local/segmentation.ts` RMBG-1.4,无 WebGPU 回退 wasm(~84MB 模型,CPU 极重);ONNX wasm 资源自托管 `apps/web/public/onnx/` |
| bundle / 懒加载 | 超过 2 MiB 的普通静态 JS chunk 不进 PWA precache;PDF worker `apps/web/public/pdf.worker.min.mjs` |
| 私有查询缓存 | React Query key 按 `userId` 分区(文件/回收站/任务/生图额度/会话),跨账号用公共前缀失效,避免复用旧账号缓存 |
