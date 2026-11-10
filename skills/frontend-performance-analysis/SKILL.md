---
name: frontend-performance-analysis
description: Use when a web UI or 3D web scene feels slow or janky — 页面卡死掉帧、FPS 低、交互无响应、主线程被长任务或 rAF 阻塞、首屏/Hydration/模型纹理加载慢、bundle 过大、内存或显存(VRAM)暴涨、WebGL context lost、标签页崩溃、DrawCall/顶点数过高、Shader 编译卡顿(Stutter);涉及普通 2D 网页、主线程 vs Web Worker、Canvas/OffscreenCanvas、WebGL/WebGPU/Three.js/R3F/Babylon.js/CAD、wasm、大 chunk 或高频重渲染。
---

# 前端性能问题分析（通用 2D 网页 & 3D 图形场景）

## 概览

**核心原则:没有测量数据不许优化;先定位是哪一层慢,再单变量验证。**

前端性能几乎都是「层」的问题。无论是普通 DOM 网页还是带 3D 场景的 Web 端,改任何东西前先确定瓶颈落在哪一层,只对最慢的那一层动手:

- **通用 2D / 应用层链路**:网络与资源加载 → Bundle 解析与 Hydration → 主线程 JS vs Web Worker → 样式/布局(Layout)/绘制(Paint)/合成 → JS 堆内存与 GC。
- **3D / WebGL / WebGPU / 重画布链路**:三维资产传输与解压(glTF/Draco/KTX2) → 主线程 `rAF` 帧逻辑(场景树遍历/动画/物理/Raycaster 拾取) → CPU→GPU 提交(Draw Calls / Uniform & Buffer 上传 / Shader 编译) → GPU 渲染管线(顶点与片元着色器 / 阴影 / 后处理 Pass / Overdraw) → 显存(VRAM)与 GPU 资源生命周期。

猜「这里肯定卡」然后直接改,是失败。先量,再定位,再验证。

## 测量优先

1. **复现并量化**:卡多久 / 掉到多少 FPS?每次都卡还是首次进视野才顿(Stutter)?输入规模多大(列表条数、图片分辨率、3D 面片数/DrawCall 数/纹理尺寸)?什么设备/DPR/浏览器?
2. **分层加证据**,一层一个手段:
   - **主线程与帧预算**:DevTools Performance 录一段。除了看 `>50ms` Long Tasks,对 3D/动画页必须看 **`FireAnimationFrame` (rAF) 耗时**——若每帧稳定 20~40ms,虽无 `>50ms` 长任务,帧率也会跌破 30fps。
   - **CPU-bound vs GPU-bound 定界(3D/画布关键)**:
     - 主线程(`CrRendererMain`)忙、GPU 线程(`CrGpuMain`)闲 → **CPU 瓶颈**(JS 计算、Raycaster 拾取、React 重渲染、或 Draw Call 数量过多导致驱动提交慢)。
     - 主线程闲(或卡在 `readPixels`/`finish` 等待)、GPU 忙,且缩小窗口或降低 `devicePixelRatio` 后帧率明显回升 → **GPU 瓶颈**(分辨率/DPR 过高、片元 Shader 复杂、后处理 Pass 过多、半透明 Overdraw 严重)。
     - 平时流畅,仅新物体入屏或切材质瞬间卡一下 → **同步上传/编译抖动**(Shader 同步编译 `compileShader/linkProgram`,或大图同步解码上传 `texImage2D`)。
   - **3D 引擎内部指标**:Three.js 打印 `renderer.info`(核查单帧 `render.calls`、`render.triangles`,以及 `memory.geometries`、`memory.textures`、`programs`);必要时用 `Spector.js` 抓单帧 WebGL 调用或 `stats-gl` 看 CPU/GPU 帧耗时。
   - **重活位置**:确认 CPU 密集处理(图片编解码、Draco/Meshopt 网格解压、物理碰撞、BVH 构建)是否真在 Web Worker 里跑,还是静默回退到了主线程。
   - **加载与首屏**:Network + Coverage 看大 chunk、未用代码与 3D 资产体积;Lighthouse 看 LCP/TBT/CLS。
   - **内存(RAM)与显存(VRAM)**:JS Heap Snapshot 只能看 JS 对象,看不到 GPU 显存!排查 3D 泄漏必须同时看 Chrome 任务管理器的 `GPU Memory`、Trace 的 `UpdateCounters` 以及切换页面后 `renderer.info.memory` 是否归零。
   - **DOM 渲染**:Performance 里的 Layout/Paint,排查强制同步布局(Layout Thrashing)或大面积重绘。
3. **只往最慢的单一层里查**,不要同时改多处。若用户未提供 trace 且本地环境可运行,优先用浏览器自动化工具复现并录制 trace 后再下结论。

## 分析别人给的 trace / profile

拿到导出的性能文件(Chrome Performance `.json`/`.json.gz`、Lighthouse JSON、React Profiler、heap snapshot、Spector.js 抓包)时:

- **铁律:大文件先脚本化抽取,绝不整份读进上下文**。trace 常几十到几百 MB,直接读会爆上下文。
- Chrome Performance trace 优先运行随附脚本:`node analyze-trace.mjs <trace.json|.json.gz> --top 20`。脚本零依赖,自动兼容现代采样式 `ProfileChunk` 与传统 `X` 事件,一次性聚合输出:
  1. 主线程时间总账(`Scripting` / `Rendering` / `Painting` / `GC` / `System`)
  2. `>50ms` Long Tasks 排行
  3. **JS self-time 热点函数**(按线程隔离)
  4. **rAF 动画帧耗时(均值/P95/超 16.7ms 比例)与真实帧率估算**
  5. **GPU / 3D 渲染管线信号**(GPU 线程负载、DrawCall 提交、Shader 编译、CPU-GPU 同步停顿、Raycaster 拾取、纹理解码上传)
  6. DOM 强制同步布局(Layout Thrashing)
  7. **GC 停顿与内存/DOM 节点/监听器/显存趋势(`UpdateCounters`)**
  8. 线程忙碌占比与基于实际信号的优化建议
- **钻取时间窗**:对可疑长任务或掉帧区间用 `--window START-END`(毫秒,相对 trace 起点),脚本会**同时过滤该时间窗内的主线程 X 事件与 CPU Profile 采样函数热点**。
- **警惕测量假象**:`CpuProfiler::StartProfiling`、`V8.HandleInterrupts` 等属于录制器自身开销,脚本已自动过滤,切勿当业务问题优化。
- **默认全程扫**,再对现象时间窗 `--window` 细看。拿到输出对回下方阈值表和症状表。

## 关键指标阈值(「慢」的客观基准)

### 通用 2D 与主线程指标

| 指标 | 好 | 差 | 含义 |
|---|---|---|---|
| Long Task | 无 >50ms | 频繁 >50ms | 单个宏任务阻塞主线程,输入无响应 |
| rAF 单帧耗时 | <10ms | P95 >16.7ms (120Hz 下 >8.3ms) | 动画或 3D 每帧超预算,即使无 >50ms 长任务也会持续掉帧 |
| INP | <200ms | >500ms | 交互到下次绘制延迟,卡顿主观感受 |
| LCP / CLS | <2.5s / <0.1 | >4s / >0.25 | 首屏最大内容绘制 / 视觉布局偏移 |
| 主线程 Scripting 占比 | — | >50% | CPU-bound,重点查 JS self-time 热点 |
| GC 停顿占比 | <2% | >10% | 热路径频繁分配临时对象(Object Churn) |

### 3D / WebGL / WebGPU 场景经验基准

| 指标 | 好(桌面 / 移动) | 差 / 危险信号 | 含义 |
|---|---|---|---|
| 单帧 Draw Calls (`render.calls`) | <200 / <80 | >1000 | CPU→GPU 驱动提交瓶颈,需 Instancing / 合批 |
| 同屏三角面 (`render.triangles`) | <100万 / <30万 | >300万且无 LOD | 顶点处理与光栅化压力过大 |
| 渲染像素比 (`devicePixelRatio`) | 限制 `<=2` | 原生 `>=3` 且开全屏后处理 | 3x DPR 像素量是 1x 的 9 倍,极易打满片元着色器 |
| 单张纹理分辨率 | `<=2048²` (KTX2) | 多张 `4096²~8192²` 未压缩 PNG/JPG | 解码卡主线程 + 显存瞬间暴涨数百 MB |
| 场景卸载后 `geometries / textures` | 回落至基线 | 随切换场景单调递增 | GPU 显存泄漏,终将触发 `WebGL context lost` |

## 分层症状对照表(通用 2D + 3D 场景)

| 症状 | 可能瓶颈层 | 检查方式 | 常见根因 / 修复方向 |
|---|---|---|---|
| 处理时页面卡死、交互无响应 | 重活跑在主线程 | Trace 看 Long Tasks 与线程忙碌占比 | CPU 密集(编解码/解压/大计算)挪进 Web Worker,或用 `scheduler.yield()` 分片让出主线程 |
| Worker 应该生效却仍卡 | Worker 前提不满足回退 | 查 `OffscreenCanvas` / 特性检测是否通过 | 缺 `OffscreenCanvas` / `SharedArrayBuffer` 时静默回退主线程;检测失败要有可见降级策略 |
| 首屏慢、加载久或 SSR 出来点不动 | Bundle 过大 / Hydration 阻塞 | Coverage + Network + Trace 首屏长任务 | 路由与重型组件(3D 引擎/编辑器/图表)动态 `import()`;推迟非首屏水合 |
| 长列表滚动掉帧、输入卡顿 | DOM 节点过多 / 强制同步布局 / 高频重渲染 | Trace 看 Layout 次数、React 渲染范围 | 虚拟列表窗口化;批量读布局再写 DOM;高频状态(滚动/指针)用 ref 或原子订阅而非顶层 State |
| 3D 持续掉帧,但 JS 计算少、GPU 也未满载 | Draw Call 过多(CPU 提交瓶颈) | 查 `renderer.info.render.calls` 与 `renderBufferDirect` 耗时 | 成百上千独立 Mesh 逐个提交;相同几何+材质改用 `InstancedMesh`,同材质不同几何用 `BatchedMesh` 或静态 Merge |
| 3D 持续掉帧,缩小窗口或降 DPR 帧率大涨 | GPU 片元 / 后处理 / Overdraw 瓶颈 | 查 `CrGpuMain` 负载,对比 `setPixelRatio(1)` 帧率 | 限制 `Math.min(devicePixelRatio, 2)`;合并/精简后处理 Pass(SSR/SSAO/Bloom);降低阴影贴图尺寸;减少大面积半透明叠层 |
| 3D 首次转向某物体或切材质时瞬卡一下 | Shader 同步编译 / 大纹理同步上传 | Trace 查 `compileShader` / `linkProgram` / `texImage2D` 峰值 | 进场景前用 `renderer.compileAsync()` 预编译;复用材质实例避免动态改宏;纹理转 KTX2 或 `createImageBitmap` 异步上传 |
| 3D 场景内移动鼠标(Hover/拖拽)严重掉帧 | 主线程 `Raycaster` 全量遍历高模 + 触发 React 重渲染 | Trace 查 `raycast`/`intersectObjects` 耗时 | 引入 `three-mesh-bvh` 建立空间索引,或用低模代理包围盒(Proxy Mesh)拾取;`pointermove` 加节流;Hover 状态勿触发全树 `setState` |
| 3D 动画每隔几秒规律性小顿一下 | `rAF` 热路径临时对象分配触发 GC | Trace 查 MinorGC 频率与 `useFrame`/rAF 内存齿状波 | 严禁在 `rAF`/`useFrame` 内 `new THREE.Vector3()`/`Matrix4()`/`Color()`;一律提取为模块级复用变量(Scratch Objects) |
| 3D 画面静止时电脑发热、风扇狂转 | 静态场景 60fps 死循环空转渲染 | 无交互时录 Trace 仍见满频 `FireAnimationFrame` | 展示类/CAD 类场景改为按需渲染(`frameloop="demand"`),仅在相机控制器变化、动画播放或数据更新时请求重绘 |
| 切换几次页面/模型后变卡、白屏崩溃 | JS 内存或 GPU 显存(VRAM)泄漏 | 对比前后 Heap Snapshot 与 `renderer.info.memory` | 2D 清理定时器/监听/离屏 Canvas;3D 卸载时必须递归调用 `geometry.dispose()`、`material.dispose()`、`texture.dispose()`、`renderTarget.dispose()` |
| 3D 模型加载极慢、解析瞬间页面冻结 | 原始模型/纹理未压缩或主线程解析 | Network 看资产体积 + Trace 看解析长任务 | 模型用 glb + **Draco / Meshopt** 压缩(Worker 解压);纹理转 **KTX2 / BasisU**;大场景分级 LOD 与视锥体按需加载 |

## 优化

- **排优先级**:先打**关键路径或每帧热路径(`rAF`)上 self-time 最高**的那一项。区分一次性成本(首屏加载、预编译)和每帧重复成本(60Hz 下每帧省 5ms = 每秒省 300ms CPU 时间)。
- **2D 技术菜单**:CPU 密集进 Web Worker;长任务 `scheduler.yield()` 分片;长列表虚拟化;重依赖路由级 code split + 交互懒加载;读写分离消除 layout thrashing;及时释放离屏 Canvas / `ImageBitmap` / `ObjectURL`。
- **3D 技术菜单**:
  - **减提交**:`InstancedMesh` / `BatchedMesh` / `mergeGeometries` 压降 Draw Calls。
  - **减面与加速**:Draco/Meshopt 压缩、多级 `LOD`、`three-mesh-bvh` 加速射线拾取、视锥剔除。
  - **减像素与着色**:`renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`、合并 Post-processing Pass、烘焙光照/AO 替代昂贵实时光影、按需渲染(`demand`)。
  - **稳帧与显存**:KTX2 GPU 压缩纹理、`compileAsync` 预编译 Shader、rAF 循环零对象分配(复用 `_vec3`/`_mat4`)、卸载时完整 `dispose()` 链条。
- **防回归**:一次只改一个变量,用改后的 trace 或计数器复测**同一**指标对比。

## 分析结论怎么呈现

输出**按严重度排序的清单**,每条 = 一句现象 + 证据(哪个函数/事件 / 多少 ms / 占比 / 触发几次 / DrawCalls 或内存变化)+ 落在哪层 + 优化方向。**只写有测量数据支撑的结论;没数据支撑的标注「需进一步测量」,绝不把猜测写成定论。**

## 假设与单变量验证

- 一次只改一个变量。改前记下 baseline 数字(耗时、FPS/P95 帧间隔、TBT、DrawCalls、内存/显存峰值),改后对比**同一**指标。
- 没提升就回滚,别在上面叠加第二个改动。
- 拿不准就说「我不确定哪层慢」,回去补测量(跑 `analyze-trace.mjs` 或打印 `renderer.info`),不要硬猜。

## 红旗——停下来重新测量

- 「这里肯定卡」但没有 Performance trace、FPS 或 `renderer.info` 数字
- 3D 掉帧时不分青红皂白先减模型面数,却没看是 CPU DrawCall 瓶颈、Raycaster 瓶颈还是 GPU 分辨率瓶颈
- 只看 JS Heap 以为没有内存泄漏,却漏查 WebGL/WebGPU 纹理与几何体显存未 `dispose()`
- 在 `rAF` / `useFrame` 循环里写 `new Vector3()`、调 `setState()` 或调 `gl.readPixels()` / `gl.getError()`
- 一次改多处 / 同时改 Worker、改 Shader 又改 React 组件
- 拿 dev 模式(未压缩、含 React 双重渲染与源码映射开销)当最终性能数据

## 验证清单

声明「性能已改善」前必须确认:

- [ ] 有改前 / 改后的**同指标**数字(耗时 / P95 帧间隔 / TBT / DrawCalls / 内存或显存峰值),复现场景一致;有 trace 就用改后 trace 复测同指标
- [ ] 3D 场景若涉及组件挂载/卸载或模型切换,已确认 `renderer.info.memory` 中的 `geometries` 和 `textures` 无净增长泄漏
- [ ] 相关测试通过,画面视觉与交互无回归
- [ ] 在偏弱设备、高分屏或节流 CPU/GPU 下也确认过,不是只在高端独显机好看
- [ ] 改的是最慢的那一层,不是顺手动了别处
