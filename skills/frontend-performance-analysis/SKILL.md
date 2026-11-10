---
name: frontend-performance-analysis
description: Use when a web UI or 3D web scene feels slow or janky — 页面卡死掉帧、FPS 低、交互无响应(INP 差)、主线程被长任务或 rAF 阻塞、首屏(LCP)/Hydration/模型纹理加载慢、CLS 布局偏移、bundle 过大、内存或显存(VRAM)暴涨、WebGL context lost、标签页崩溃、DrawCall/顶点数过高、Shader/Pipeline 编译卡顿(Stutter);涉及普通 2D 网页、主线程 vs Web Worker、Canvas/OffscreenCanvas、WebGL/WebGPU/Three.js/R3F/Babylon.js/CAD、wasm、大 chunk 或高频重渲染。
---

# 前端性能问题分析（通用 2D 网页 & 3D 图形场景）

## 概览

**核心原则:没有测量数据不许优化;先定位是哪一层慢,再单变量验证。**

前端性能几乎都是「层」的问题。无论是普通 DOM 网页还是带 3D 场景的 Web 端,改任何东西前先确定瓶颈落在哪一层,只对最慢的那一层动手:

- **通用 2D / 应用层链路**:网络与资源加载(LCP/字体/大图) → Bundle 解析与 Hydration → 主线程 JS vs Web Worker → 样式/布局(Layout)/绘制(Paint)/合成层(Compositor Layers) → JS 堆内存、离屏 DOM 与 GC。
- **3D / WebGL / WebGPU / 重画布链路**:三维资产传输与解压(glTF/Draco/Meshopt/KTX2) → 主线程 `rAF` 帧逻辑(场景树遍历/动画/物理/Raycaster 拾取) → CPU→GPU 命令提交(Draw Calls / Uniform & Buffer 写入 / BindGroup 组装 / Shader 与 Pipeline 编译) → GPU 硬件渲染管线(顶点与片元着色器 / 阴影 / 后处理 Pass / 透明度 Overdraw) → 显存(VRAM)与 GPU 资源生命周期。

猜「这里肯定卡」然后直接改,是失败。先量,再定位,再验证。

## 测量优先与标准录制姿势

1. **复现并量化**:卡多久 / 掉到多少 FPS?每次都卡还是首次进视野才顿(Stutter)?输入规模多大(列表条数、图片分辨率、3D 面片数/DrawCall 数/纹理尺寸)?什么设备/DPR(60Hz vs 120Hz)/浏览器?
2. **用干净、可复现的姿势录制数据**:
   - **环境铁律**:必须在 **Production 构建**(或保留函数名的 profiling 构建 `keep_fnames: true` + Source Maps)与 **无痕窗口(Incognito)** 下测量,排除 React Dev 双重渲染与浏览器扩展(`CrRendererMain` 噪音进程)干扰;复现移动端或弱机时开启 CPU 4×/6× 节流。
   - **DevTools 手动录制**:Performance 面板勾选 **Memory**(采集 `UpdateCounters` 中的 `jsHeapSizeUsed` / `nodes` / `documents` / `jsEventListeners`),取消勾选 `Disable JavaScript samples`;查绘制与合成层膨大时勾选 `Enable advanced paint instrumentation`。
   - **Playwright / CDP 自动化录制**:若本地可运行且用户未给 trace,通过 CDP `Tracing.start` 录制复现区间,必开 categories(其中 `timeline.stack` 用于捕获强制同步布局的触发调用栈,`gpu` 用于捕获 `GPUTask.used_bytes` 显存与 `GLES2::*` 同步等待事件):
     `['devtools.timeline', 'v8.execute', 'blink.user_timing', 'latencyInfo', 'loading', 'gpu', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-devtools.timeline.stack', 'disabled-by-default-v8.cpu_profiler']`。
   - **线上与现代长帧采集(LoAF)**:偶发卡顿优先采集 **Long Animation Frames API** (`PerformanceObserver({ type: 'long-animation-frame' })`),直接获取 `>50ms` 慢帧的 `blockingDuration` 与归因脚本 URL/函数名。
   - **iOS Safari / 移动端专项**:iOS Safari 使用 Web Inspector **Timelines**。注意 Safari WebKit 对单页 **整体 Canvas 缓冲区内存** 有硬上限(常在 **256MB~384MB** 触发画布清空或页面崩溃重载),且移动 Tile-Based GPU(TBDR)对多 Pass 后处理、`alpha: true`、`preserveDrawingBuffer: true` 极其敏感。
3. **分层加证据**,一层一个手段:
   - **主线程与帧预算**:除了看 `>50ms` Long Tasks 及其内部主导调用链,对 3D/动画页必须看 **`FireAnimationFrame` (rAF) 耗时**——若每帧稳定 20~40ms,虽无 `>50ms` 长任务,帧率也会跌破 30fps。
   - **CPU-bound vs GPU-bound 严格定界(3D/画布关键)**:
     - **警惕 `CrGpuMain` 误区**:Chrome Trace 中的 `CrGpuMain` 是 GPU 进程里的 **CPU 命令解码与驱动提交线程**,不直接等于显卡硬件执行片元着色器的时间!
     - **CPU 瓶颈**:主线程(`CrRendererMain`)忙,或卡在 `GLES2::ReadPixels`/`WaitForCmd` 同步等待,或 `CrGpuMain` 因每帧上千次 Draw Call 命令解码而忙,但缩小画布分辨率后帧率几乎不变。
     - **GPU 硬件瓶颈**:主线程闲,且做 **DPR 缩放对照实验**(`renderer.setPixelRatio(1)` 或将窗口缩小至 1/4)后 **帧率立即大幅回升**;或通过 `stats-gl` / `EXT_disjoint_timer_query_webgl2` / WebGPU `timestamp-query` 实测 GPU 硬件帧耗时 `>16ms`。
     - **同步编译/等待尖峰(Stutter)**:平时流畅,仅新物体入屏或切材质瞬间卡顿 → 查 Shader/Pipeline 同步编译(`compileShader`/`linkProgram`/`GLES2::CompileShader`/`createRenderPipeline`),或 CPU-GPU 同步回读(`readPixels`/`getError`/`mapAsync`)引发管线停顿(Pipeline Stall)。
   - **3D 引擎内部计数器**:Three.js 打印 `renderer.info`(核查单帧 `render.calls`、`render.triangles`,以及 `memory.geometries`、`memory.textures`、`programs`);必要时用 `Spector.js` 抓单帧调用。
   - **内存(RAM)与显存(VRAM)**:JS Heap 采用**「三快照对比法」**(进入前 → 打开并关闭组件 → 手动 GC 后再拍,筛选 Snapshot 1~2 分配且 Snapshot 3 残留对象与 `Detached HTMLDivElement`);3D 显存核对 Trace 中 `GPUTask.args.data.used_bytes`、Chrome 任务管理器的 `GPU Memory` 以及卸载后 `renderer.info.memory` 是否归零(注意 `UpdateCounters` 不含显存字段)。

## 分析别人给的 trace / profile

拿到导出的性能文件(Chrome Performance `.json`/`.json.gz`、Lighthouse JSON、React Profiler、heap snapshot)时:

- **铁律:大文件先脚本化抽取,绝不整份读进上下文**。trace 常几十到几百 MB,直接读会爆上下文。
- Chrome Performance trace 优先运行本技能目录下的零依赖分析器(若文件 >500MB 可加 `node --max-old-space-size=8192`):
  ```bash
  # 全程扫描(自动锁定主页面 CrRendererMain,继承父类别精确归账,输出 LongTask 主导调用链与 3D/CWV 信号)
  node skills/frontend-performance-analysis/analyze-trace.mjs <trace.json|.json.gz> --top 20

  # 钻取特定卡顿时间窗(同时输出该时间窗内的主线程 X 事件与 CPU 采样函数热点)
  node skills/frontend-performance-analysis/analyze-trace.mjs <trace.json> --window 1200-1850

  # 120Hz 高刷屏预算分析(按 8.3ms/帧统计超预算比例)
  node skills/frontend-performance-analysis/analyze-trace.mjs <trace.json> --fps 120

  # 单变量改动前后对比(按录制跨度归一化对比,带 ±5% 噪声带判定改善/退化)
  node skills/frontend-performance-analysis/analyze-trace.mjs <before.json> --compare <after.json>
  ```
- **警惕测量假象与代码压缩**:`CpuProfiler::StartProfiling`、`V8.HandleInterrupts` 属于录制器开销(脚本已过滤)。若采样热点全是单字母混淆名,优先依赖脚本从原生事件(`GLES2::ReadPixels`/`CompileShader`/`Layout`)提取的耗时,并提示开启 Source Map 或 `keep_fnames` 复测。

## 关键指标阈值(「慢」的客观基准)

### 通用 2D 与主线程指标

| 指标 | 好 | 警告 | 差 / 危险 | 含义 |
|---|---|---|---|---|
| Long Task / LoAF | 无 >50ms | 偶发 50~100ms | 频繁 >100ms | 单个宏任务或长动画帧阻塞主线程,输入无响应 |
| rAF 单帧耗时 | <10ms (60Hz) | 10~16.7ms | P95 >16.7ms (120Hz 下 >8.3ms) | 动画或 3D 每帧超预算,即使无 >50ms 长任务也会持续掉帧 |
| INP (交互延迟) | <200ms | 200~500ms | >500ms | 输入排队延迟 + 事件处理 + 下一帧合成呈现总耗时 |
| LCP / CLS(会话窗口) | <2.5s / <0.1 | 2.5~4s / 0.1~0.25 | >4s / >0.25 | 首屏最大内容绘制(需含 `navigationStart`) / 视觉布局偏移 |
| 主线程 Scripting 占比 | <30% | 30%~50% | >50% | CPU-bound(或被同步 GPU 调用阻塞),重点查热点函数 |
| GC 停顿占比 | <2% | 2%~10% | >10% | 热路径频繁分配临时对象(Object Churn) |

### 3D / WebGL / WebGPU 场景经验基准

| 指标 | 好(桌面 / 移动) | 警告(需关注) | 差 / 危险信号 | 含义 |
|---|---|---|---|---|
| 单帧 Draw Calls (`render.calls`) | <200 / <80 | 200~800 / 80~250 | >1000 / >300 | CPU→GPU 驱动提交瓶颈,需 Instancing / 合批 / RenderBundle |
| 同屏三角面 (`render.triangles`) | <100万 / <30万 | 100~300万 / 30~80万 | >300万且无 LOD | 顶点处理与光栅化压力过大 |
| 渲染像素比 (`devicePixelRatio`) | 限制 `<=2` | 桌面 `2~2.5` | 移动 `>=3` 且开全屏后处理 | 3x DPR 像素量是 1x 的 9 倍,极易打满片元着色器与移动端带宽 |
| 单张纹理尺寸与格式 | `<=2048²` (KTX2) | `4096²` 未压缩 | 多张 `4096²~8192²` PNG/JPG | 主线程解码卡顿 + 显存暴涨(1 张 4K RGBA Mipmap ≈ 85MB VRAM) |
| 场景卸载后 `geometries / textures` | 回落至基线 | 偶有残留缓存 | 随切换场景单调递增 | GPU 显存泄漏,终将触发 `WebGL context lost` 或移动端页面崩溃 |

## 分层反模式速查与诊断报告模板

定位具体症状的根因、工程修复方案(含 2D 长任务/Worker/LCP/强制布局/合成层爆炸 + 3D DrawCall/片元超载/Shader 预编译/BVH 射线拾取/rAF 零分配/按需渲染/显存回收)及标准 5 节诊断报告模板,请查阅详细参考手册:

- **[references/anti-patterns-and-report.md](./references/anti-patterns-and-report.md)** — 在给出具体优化方案或撰写性能诊断报告前按需读取。

## 红旗——停下来重新测量

- 「这里肯定卡」但没有 Performance trace、FPS 或 `renderer.info` 数字
- 把 `CrGpuMain` 耗时高直接等同于「显卡算力不够」,没做降 DPR 对照实验也没看是不是 Draw Call 命令或 `readPixels` 同步等待过多
- 3D 掉帧时不分青红皂白先减模型面数,却没看是 CPU DrawCall 瓶颈、Raycaster 瓶颈还是 GPU 片元瓶颈
- 只看 JS Heap 以为没有内存泄漏,却漏查 WebGL/WebGPU 纹理与几何体显存未 `dispose()`
- 在 `rAF` / `useFrame` 循环里写 `new Vector3()`、调 `setState()` 或调 `gl.readPixels()` / `gl.getError()`
- 一次改多处 / 同时改 Worker、改 Shader 又改 React 组件
- 拿 dev 模式(未压缩、含 React 双重渲染与扩展插件干扰)当最终性能数据

## 验证清单

声明「性能已改善」前必须确认:

- [ ] 有改前 / 改后的**同指标**数字(直接跑 `analyze-trace.mjs before.json --compare after.json`),复现场景一致
- [ ] 3D 场景若涉及组件挂载/卸载或模型切换,已确认 `renderer.info.memory` 中的 `geometries` 和 `textures` 无净增长泄漏
- [ ] 相关测试通过,画面视觉与交互无回归
- [ ] 在偏弱设备、高分屏(DPR>=2)或节流 CPU/GPU 下也确认过,不是只在高端独显机好看
- [ ] 改的是最慢的那一层,不是顺手动了别处
