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
   - **DevTools 手动录制**:Performance 面板勾选 **Screenshots**、**Memory**(采集 `UpdateCounters` 中的 JS Heap / DOM Nodes / Listeners / GPU Memory),取消勾选 `Disable JavaScript samples`;查绘制与合成层膨大时勾选 `Enable advanced paint instrumentation`。
   - **Playwright / CDP 自动化录制**:若本地可运行且用户未给 trace,通过 CDP `Tracing.start` 录制复现区间,必开 categories:
     `['devtools.timeline', 'v8.execute', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-v8.cpu_profiler', 'blink.user_timing', 'latencyInfo', 'gpu']`。
   - **线上与现代长帧采集(LoAF)**:实验室外或偶发卡顿优先采集 **Long Animation Frames API** (`PerformanceObserver({ type: 'long-animation-frame' })`),可直接拿到 `>50ms` 慢帧的阻塞总时长(`blockingDuration`)与具体归因脚本 URL/函数名,比传统 `longtask` 信息完整得多。
   - **iOS Safari / 移动端专项**:iOS Safari 无 Chrome Trace,使用 Safari Web Inspector **Timelines**(CPU / Memory / JavaScript & Events / Frames)。注意 iOS WebKit 对单页 Canvas + WebGL 显存有严格硬上限(常在 **256MB~384MB** 触发 `webglcontextlost` 或页面直接重载),且移动 Tile-Based GPU(TBDR)对多 Pass 后处理、`alpha: true`、`preserveDrawingBuffer: true` 极其敏感。
3. **分层加证据**,一层一个手段:
   - **主线程与帧预算**:除了看 `>50ms` Long Tasks,对 3D/动画页必须看 **`FireAnimationFrame` (rAF) 耗时**——若每帧稳定 20~40ms,虽无 `>50ms` 长任务,帧率也会跌破 30fps。
   - **CPU-bound vs GPU-bound 严格定界(3D/画布关键)**:
     - **警惕 `CrGpuMain` 误区**:Chrome Trace 中的 `CrGpuMain` 是 GPU 进程里的 **CPU 命令解码与驱动提交线程**,不直接等于显卡硬件执行片元着色器的时间!
     - **CPU 瓶颈**:主线程(`CrRendererMain`)忙,或 `CrGpuMain` 因每帧上千次 Draw Call / `writeBuffer` 命令解码而忙,但缩小画布分辨率后帧率几乎不变。
     - **GPU 硬件瓶颈**:主线程闲,且做 **DPR 缩放对照实验**(`renderer.setPixelRatio(1)` 或将窗口缩小至 1/4)后 **帧率立即大幅回升**;或通过 `stats-gl` / `EXT_disjoint_timer_query_webgl2` / WebGPU `timestamp-query` 实测 GPU 硬件帧耗时 `>16ms`。
     - **同步编译/等待尖峰(Stutter)**:平时流畅,仅新物体入屏或切材质瞬间卡顿 → 查 Shader/Pipeline 同步编译(`compileShader`/`linkProgram`/`createRenderPipeline`),或 CPU-GPU 同步回读(`readPixels`/`getError`/`mapAsync`)引发管线停顿(Pipeline Stall)。
   - **3D 引擎内部计数器**:Three.js 打印 `renderer.info`(核查单帧 `render.calls`、`render.triangles`,以及 `memory.geometries`、`memory.textures`、`programs`);必要时用 `Spector.js` 抓单帧 WebGL/WebGPU 调用。
   - **内存(RAM)与显存(VRAM)**:JS Heap 采用**「三快照对比法」**(进入前 → 交互/打开并关闭组件 → 手动 GC 后再拍,筛选 Snapshot 1 到 2 之间分配且 Snapshot 3 仍残留的对象与 `Detached HTMLDivElement`);3D 显存必须同时核对 Chrome 任务管理器的 `GPU Memory`、Trace 的 `UpdateCounters` 以及卸载后 `renderer.info.memory` 是否归零。

## 分析别人给的 trace / profile

拿到导出的性能文件(Chrome Performance `.json`/`.json.gz`、Lighthouse JSON、React Profiler、heap snapshot、Spector.js 抓包)时:

- **铁律:大文件先脚本化抽取,绝不整份读进上下文**。trace 常几十到几百 MB,直接读会爆上下文。
- Chrome Performance trace 优先运行本技能目录下的零依赖分析器:
  ```bash
  # 全程扫描(自动按 TracingStartedInBrowser 锁定主页面进程,兼容 >512MB 超大文件流式回退)
  node skills/frontend-performance-analysis/analyze-trace.mjs <trace.json|.json.gz> --top 20

  # 钻取特定卡顿时间窗(同时输出该时间窗内的主线程 X 事件与 CPU 采样函数热点)
  node skills/frontend-performance-analysis/analyze-trace.mjs <trace.json> --window 1200-1850

  # 120Hz 高刷屏预算分析(按 8.3ms/帧统计超预算比例)
  node skills/frontend-performance-analysis/analyze-trace.mjs <trace.json> --fps 120

  # 单变量改动前后对比(直接生成 Before → After 核心指标变化与改善/退化标记)
  node skills/frontend-performance-analysis/analyze-trace.mjs <before.json> --compare <after.json>
  ```
- **警惕测量假象与代码压缩**:`CpuProfiler::StartProfiling`、`V8.HandleInterrupts` 属于录制器自身开销(脚本已过滤)。若热点全是 `a.b`、`e` 等单字母函数,说明是无 Source Map 的压缩包,应提示开启 Source Map 或用 `keep_fnames` 构建复测,切勿盲猜函数职责。

## 关键指标阈值(「慢」的客观基准)

### 通用 2D 与主线程指标

| 指标 | 好 | 警告 | 差 / 危险 | 含义 |
|---|---|---|---|---|
| Long Task / LoAF | 无 >50ms | 偶发 50~100ms | 频繁 >100ms | 单个宏任务或长动画帧阻塞主线程,输入无响应 |
| rAF 单帧耗时 | <10ms (60Hz) | 10~16.7ms | P95 >16.7ms (120Hz 下 >8.3ms) | 动画或 3D 每帧超预算,即使无 >50ms 长任务也会持续掉帧 |
| INP (交互延迟) | <200ms | 200~500ms | >500ms | 输入延迟 + 事件处理 + 下一帧绘制总耗时 |
| LCP / CLS | <2.5s / <0.1 | 2.5~4s / 0.1~0.25 | >4s / >0.25 | 首屏最大内容绘制 / 无预期视觉布局偏移 |
| 主线程 Scripting 占比 | <30% | 30%~50% | >50% | CPU-bound,重点查 JS self-time 热点 |
| GC 停顿占比 | <2% | 2%~10% | >10% | 热路径频繁分配临时对象(Object Churn) |

### 3D / WebGL / WebGPU 场景经验基准

| 指标 | 好(桌面 / 移动) | 警告(需关注) | 差 / 危险信号 | 含义 |
|---|---|---|---|---|
| 单帧 Draw Calls (`render.calls`) | <200 / <80 | 200~800 / 80~250 | >1000 / >300 | CPU→GPU 驱动提交瓶颈,需 Instancing / 合批 / RenderBundle |
| 同屏三角面 (`render.triangles`) | <100万 / <30万 | 100~300万 / 30~80万 | >300万且无 LOD | 顶点处理与光栅化压力过大 |
| 渲染像素比 (`devicePixelRatio`) | 限制 `<=2` | 桌面 `2~2.5` | 移动 `>=3` 且开全屏后处理 | 3x DPR 像素量是 1x 的 9 倍,极易打满片元着色器与移动端带宽 |
| 单张纹理尺寸与格式 | `<=2048²` (KTX2) | `4096²` 未压缩 | 多张 `4096²~8192²` PNG/JPG | 主线程解码卡顿 + 显存暴涨(1 张 4K RGBA Mipmap ≈ 85MB VRAM) |
| 场景卸载后 `geometries / textures` | 回落至基线 | 偶有残留缓存 | 随切换场景单调递增 | GPU 显存泄漏,终将触发 `WebGL context lost` 或 iOS 页面崩溃 |

## 分层症状与 12 类高频反模式速查表

| # | 症状 | 瓶颈层 | 核查证据 | 常见根因(反模式)与修复方案 |
|---|---|---|---|---|
| 1 | 处理时页面卡死、交互无响应(INP 高) | 主线程长任务 | Trace 看 Long Tasks / LoAF 与 JS 热点 | **反模式**:主线程同步跑编解码/解压/大数组遍历。<br>**改法**:纯计算挪进 Web Worker;UI 任务用 `scheduler.yield()` 分片让出主线程。 |
| 2 | Worker 应该生效却仍卡主线程 | Worker 回退或空转 | Trace 看 `[Web Worker JS 热点]` 与线程忙碌比 | **反模式**:缺 `OffscreenCanvas` / `SharedArrayBuffer` 时静默回退主线程,或主线程与 Worker 之间高频拷贝大对象而非 `Transferable`。<br>**改法**:核查特性检测分支,大 Buffer 必须走 `postMessage(buf, [buf])` 零拷贝转移。 |
| 3 | 首屏慢(LCP 差)或 SSR 出来点不动 | 资源加载 / Hydration | Network 瀑布 + Coverage + 首屏长任务 | **反模式**:首屏打包进 Three.js/Monaco/大图表全量包;LCP 大图无 `fetchpriority="high"` 或被懒加载。<br>**改法**:重型 3D/编辑器组件 `next/dynamic` 或动态 `import()`;首屏关键图用 AVIF/WebP + 预加载。 |
| 4 | 长列表滚动掉帧、输入卡顿 | DOM 规模 / 强制同步布局 | Trace 看 `强制同步布局` 次数与 Layout 耗时 | **反模式**:在 `scroll`/`resize`/`rAF` 内先写样式再读 `offsetTop`/`getBoundingClientRect` 触发 Layout Thrashing;或上万 DOM 节点全量挂载。<br>**改法**:读写分离;虚拟列表窗口化;离屏长区块加 `content-visibility: auto`。 |
| 5 | 页面动画卡顿且 GPU 显存莫名飙高(非 3D 页) | CSS 合成层爆炸 | DevTools Layers 面板看合成层数量与显存占用 | **反模式**:对几百个列表项滥加 `will-change: transform`、`backdrop-filter: blur()` 或大尺寸 `filter: drop-shadow`,导致合成层爆炸吃光显存。<br>**改法**:仅在动画执行期间动态挂载 `will-change`,优先用 `transform`/`opacity` 合成属性。 |
| 6 | 3D 持续掉帧,但 JS 逻辑简单、降分辨率也无效 | Draw Call 提交瓶颈 | `renderer.info.render.calls` 高;Trace 中 `renderBufferDirect` 占比高 | **反模式**:成百上千个独立 `Mesh` 逐个提交。<br>**改法**:相同几何+材质改用 `InstancedMesh`;同材质不同几何用 `BatchedMesh` 或 `mergeGeometries`;WebGPU 下使用 `GPURenderBundleEncoder` 录制复用。 |
| 7 | 3D 持续掉帧,缩小窗口或 `setPixelRatio(1)` 后帧率大涨 | GPU 硬件片元 / 填充率 / 后处理瓶颈 | DPR 缩放对照实验帧率差 >50%;`stats-gl` GPU 耗时高 | **反模式**:Retina 屏默认跑 `DPR=3` + 多重全屏后处理(SSR/SSAO/Bloom/DOF) + 高分辨率实时阴影 + 大面积半透明叠层(Overdraw)。<br>**改法**:强制 `Math.min(devicePixelRatio, 2)`(移动端可动态降级至 `1~1.5`);合并 Post-processing Pass;烘焙光照/AO 替代实时计算。 |
| 8 | 3D 首次转向某物体或切材质瞬间卡顿一下(Stutter) | Shader / Pipeline 同步编译 | Trace 中 `compileShader` / `linkProgram` / `createRenderPipeline` 出现 >16ms 尖峰 | **反模式**:物体首次进视锥或运行时修改材质属性(`transparent`/`defines`)触发主线程/GPU 同步编译着色器。<br>**改法**:加载阶段调用 `await renderer.compileAsync(scene, camera)` 或 WebGPU `createRenderPipelineAsync()`;复用材质实例,用 Uniform 替代动态改 Shader 宏。 |
| 9 | 3D 场景内移动鼠标(Hover/拖拽)严重掉帧 | 主线程 `Raycaster` 遍历 + React 重渲染 | Trace 中 `raycast`/`intersectObjects` 含子调用耗时高 | **反模式**:在 `pointermove` 中每毫秒对数万面高模做暴力三角面求交,且把命中的坐标直接 `setState` 触发整棵 R3F/React 树重渲染。<br>**改法**:引入 `three-mesh-bvh` 建立 BVH 空间加速结构,或用低模包围盒(Proxy Mesh)代理拾取;Hover 状态存 `useRef` 直接改材质 Uniform。 |
| 10 | 3D 动画每隔几秒规律性微顿(Sawtooth 锯齿卡顿) | `rAF` 每帧对象分配触发 GC | Trace 中 `GC` 频发,JS Heap 呈高频锯齿波 | **反模式**:在 `rAF` / R3F `useFrame` 内每帧执行 `new THREE.Vector3()`、`new Matrix4()`、`array.map/filter`,或 WebGPU 每帧重建 `GPUBindGroup`/`GPUBuffer`。<br>**改法**:在模块顶层预分配临时复用变量(`const _v3 = new Vector3()`);WebGPU 缓存复用 `BindGroup` 并合并 `queue.writeBuffer`。 |
| 11 | 3D 画面静止时电脑发热、风扇狂转、续航崩塌 | 静态场景 60/120fps 空转渲染 | 无交互录 Trace 仍见满频 `FireAnimationFrame` | **反模式**:商品预览、BIM/CAD 查看器等非连续运动场景使用无条件 `requestAnimationFrame` 死循环。<br>**改法**:改为按需渲染(R3F `frameloop="demand"`,原生在 `OrbitControls` `change` 事件或数据变更时才调用 `invalidate()` / 单帧 `render()`)。 |
| 12 | 切换几次页面/模型后变慢、白屏或 `WebGL context lost` | GPU 显存(VRAM)或 CPU-GPU 同步停顿 | `renderer.info.memory` 递增;Trace 含 `readPixels`/`getError` 或 `gpuMemoryUsedKB` 不回落 | **反模式**:组件卸载只删了 React/DOM 节点,未调 `.dispose()`;或在渲染循环内调 `gl.readPixels()`/`gl.getError()` 导致 CPU-GPU 同步等待。<br>**改法**:卸载时递归执行 `geometry/material/texture/renderTarget.dispose()`;严禁在循环内调 `getError/readPixels`(拾取或截图改用异步 PBO / `mapAsync`)。 |

## 分析结论呈现模板（强制结构）

向用户汇报性能分析或优化结果时,必须按以下结构输出(**无 3D/GPU 信号时第 3 节可简写为一行「无异常」;严禁把无测量数据的猜测写成定论**):

```markdown
### 1. 现象与测量基线
- **复现场景与规模**: [如: 加载 50MB glTF 模型并旋转相机 / 渲染 5,000 条列表, 60Hz, Production 构建]
- **核心基线指标**: 时间跨度 `X ms` | 主线程忙碌 `X%` | 估算帧率 `X FPS` (P95 帧间隔 `X ms`) | Long Tasks `X 个`

### 2. 主线程与 Web Vitals 诊断
- **时间总账**: Scripting `X ms (X%)` / Rendering `X ms` / Painting `X ms` / GC `X ms`
- **JS 热点函数 (Top 3)**: `函数名 @文件:行号` (`X ms`, 占活跃 `X%`)
- **DOM 布局与交互**: 强制同步布局 `X 次` | LCP `@+X ms` | CLS `X` | 最慢交互 `X ms`

### 3. GPU / 3D 渲染管线与内存/显存指标
- **rAF 帧预算**: 均值 `X ms` | P95 `X ms` | 超预算帧占比 `X%`
- **3D 管线耗时**: CrGpuMain `X ms (X%)` | 绘制提交 `X ms` | Shader 编译 `X ms` | Raycaster 拾取 `X ms` | 纹理解码 `X ms`
- **内存与显存趋势**: JS Heap `起点 → 峰值 → 终点 (净变)` | GPU 显存 `起点 → 峰值 → 终点` | (若有 `renderer.info`: DrawCalls `X`, Triangles `X`, Textures `X`)

### 4. 根因排序与单变量优化方案
1. **[P0 最高优 | 所属层] 一句话现象**
   - **证据**: [具体函数/事件名、耗时 ms、占比、触发次数]
   - **修复方案**: [具体代码级改法]
2. **[P1 次优 | 所属层] ...**

### 5. 单变量验证对比 (执行代码优化后必填)
| 指标 | 优化前 (Before) | 优化后 (After) | 变化幅度 |
|---|---|---|---|
| 主线程 Scripting / rAF P95 | ... | ... | ... |
| 帧率 (FPS) / 掉帧率 | ... | ... | ... |
| JS Heap / GPU 显存峰值 | ... | ... | ... |
```

## 红旗——停下来重新测量

- 「这里肯定卡」但没有 Performance trace、FPS 或 `renderer.info` 数字
- 把 `CrGpuMain` 耗时高直接等同于「显卡算力不够」,没做降 DPR 对照实验也没看是不是 Draw Call 命令过多
- 3D 掉帧时不分青红皂白先减模型面数,却没看是 CPU DrawCall 瓶颈、Raycaster 瓶颈还是 GPU 片元瓶颈
- 只看 JS Heap 以为没有内存泄漏,却漏查 WebGL/WebGPU 纹理与几何体显存未 `dispose()`
- 在 `rAF` / `useFrame` 循环里写 `new Vector3()`、调 `setState()` 或调 `gl.readPixels()` / `gl.getError()`
- 一次改多处 / 同时改 Worker、改 Shader 又改 React 组件
- 拿 dev 模式(未压缩、含 React 双重渲染与扩展插件干扰)或压缩混淆后看不清函数名的包直接下定论

## 验证清单

声明「性能已改善」前必须确认:

- [ ] 有改前 / 改后的**同指标**数字(推荐直接跑 `analyze-trace.mjs before.json --compare after.json`),复现场景一致
- [ ] 3D 场景若涉及组件挂载/卸载或模型切换,已确认 `renderer.info.memory` 中的 `geometries` 和 `textures` 无净增长泄漏
- [ ] 相关测试通过,画面视觉与交互无回归
- [ ] 在偏弱设备、高分屏(DPR>=2)或节流 CPU/GPU 下也确认过,不是只在高端独显机好看
- [ ] 改的是最慢的那一层,不是顺手动了别处
