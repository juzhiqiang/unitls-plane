# 前端 2D & 3D 性能反模式速查与诊断报告模板

> 本文档为 `frontend-performance-analysis` 技能的详细参考手册，包含 12 类高频性能反模式（2D DOM + 3D WebGL/WebGPU）的核查证据与工程改法，以及标准性能诊断报告模板。

---

## 一、分层症状与 12 类高频反模式速查表

| # | 症状 | 瓶颈层 | 核查证据 | 常见根因(反模式)与修复方案 |
|---|---|---|---|---|
| 1 | 处理时页面卡死、交互无响应(INP 高) | 主线程长任务 | Trace 看 Long Tasks 主导子链 / LoAF 与 JS 热点 | **反模式**:主线程同步跑编解码/解压/大数组遍历。<br>**改法**:纯计算挪进 Web Worker;UI 任务用 `scheduler.yield()` 分片让出主线程。 |
| 2 | Worker 应该生效却仍卡主线程 | Worker 回退或拷贝过重 | Trace 看 `[Web Worker JS 热点]` 与线程忙碌比 | **反模式**:缺 `OffscreenCanvas` / `SharedArrayBuffer` 时静默回退主线程,或主线程与 Worker 之间高频结构化克隆大对象而非 `Transferable`。<br>**改法**:核查特性检测分支,大 `ArrayBuffer`/`ImageBitmap` 必须走 `postMessage(buf, [buf])` 零拷贝转移。 |
| 3 | 首屏慢(LCP 差)或 SSR 出来点不动 | 资源加载 / Hydration | Network 瀑布 + Coverage + 首屏长任务 | **反模式**:首屏打包进 Three.js/Monaco/大图表全量包;LCP 大图无 `fetchpriority="high"` 或被懒加载。<br>**改法**:重型 3D/编辑器组件 `next/dynamic` 或动态 `import()`;首屏关键图用 AVIF/WebP + 预加载。 |
| 4 | 长列表滚动掉帧、输入卡顿 | DOM 规模 / 强制同步布局 | Trace 看 `强制同步布局` (`beginData.stackTrace`) 次数与 Layout 耗时 | **反模式**:在 `scroll`/`resize`/`rAF` 内先写样式再读 `offsetTop`/`getBoundingClientRect` 触发 Layout Thrashing;或上万 DOM 节点全量挂载。<br>**改法**:读写分离(批量读完再统一写);虚拟列表窗口化;离屏长区块加 `content-visibility: auto`。 |
| 5 | 页面动画卡顿且显存莫名飙高(非 3D 页) | CSS 合成层爆炸 | DevTools Layers 面板看合成层数量与纹理显存 | **反模式**:对几百个列表项滥加 `will-change: transform`、`backdrop-filter: blur()` 或大尺寸 `filter: drop-shadow`,导致合成层爆炸吃光显存。<br>**改法**:仅在动画执行期间动态挂载 `will-change`,优先用 `transform`/`opacity` 合成属性。 |
| 6 | 3D 持续掉帧,但 JS 逻辑简单、降分辨率也无效 | Draw Call 提交瓶颈 | `renderer.info.render.calls` 高;Trace 中 `renderBufferDirect` / `GLES2::Draw*` 占比高 | **反模式**:成百上千个独立 `Mesh` 逐个提交。<br>**改法**:相同几何+材质改用 `InstancedMesh`;同材质不同几何用 `BatchedMesh` 或 `mergeGeometries`;WebGPU 下使用 `GPURenderBundleEncoder` 录制复用。 |
| 7 | 3D 持续掉帧,缩小窗口或 `setPixelRatio(1)` 后帧率大涨 | GPU 硬件片元 / 填充率 / 后处理瓶颈 | DPR 缩放对照实验帧率差 >50%;`stats-gl` GPU 硬件耗时高 | **反模式**:Retina 屏默认跑 `DPR=3` + 多重全屏后处理(SSR/SSAO/Bloom/DOF) + 高分辨率实时阴影 + 大面积半透明叠层(Overdraw)。<br>**改法**:强制 `Math.min(devicePixelRatio, 2)`(移动端可动态降级至 `1~1.5`);合并 Post-processing Pass;烘焙光照/AO 替代实时计算。 |
| 8 | 3D 首次转向某物体或切材质瞬间卡顿一下(Stutter) | Shader / Pipeline 同步编译 | Trace 中 `compileShader` / `linkProgram` / `GLES2::CompileShader` / `createRenderPipeline` 出现 >16ms 尖峰 | **反模式**:物体首次进视锥或运行时修改材质属性(`transparent`/`defines`)触发主线程/GPU 同步编译着色器。<br>**改法**:加载阶段调用 `await renderer.compileAsync(scene, camera)` 或 WebGPU `createRenderPipelineAsync()`;复用材质实例,用 Uniform 替代动态改 Shader 宏。 |
| 9 | 3D 场景内移动鼠标(Hover/拖拽)严重掉帧 | 主线程 `Raycaster` 遍历 + React 重渲染 | Trace 中 `raycast`/`intersectObjects` 含子调用耗时高 | **反模式**:在 `pointermove` 中每毫秒对数万面高模做暴力三角面求交,且把命中的坐标直接 `setState` 触发整棵 R3F/React 树重渲染。<br>**改法**:引入 `three-mesh-bvh` 建立 BVH 空间加速结构,或用低模包围盒(Proxy Mesh)代理拾取;Hover 状态存 `useRef` 直接改材质 Uniform。 |
| 10 | 3D 动画每隔几秒规律性微顿(Sawtooth 锯齿卡顿) | `rAF` 每帧对象分配触发 GC | Trace 中 `GC` 频发,JS Heap 呈高频锯齿波 | **反模式**:在 `rAF` / R3F `useFrame` 内每帧执行 `new THREE.Vector3()`、`new Matrix4()`、`array.map/filter`,或 WebGPU 每帧重建 `GPUBindGroup`/`GPUBuffer`。<br>**改法**:在模块顶层预分配临时复用变量(`const _v3 = new Vector3()`);WebGPU 缓存复用 `BindGroup` 并合并 `queue.writeBuffer`。 |
| 11 | 3D 画面静止时电脑发热、风扇狂转、续航崩塌 | 静态场景 60/120fps 空转渲染 | 无交互录 Trace 仍见满频 `FireAnimationFrame` | **反模式**:商品预览、BIM/CAD 查看器等非连续运动场景使用无条件 `requestAnimationFrame` 死循环。<br>**改法**:改为按需渲染(R3F `frameloop="demand"`,原生在 `OrbitControls` `change` 事件或数据变更时才调用 `invalidate()` / 单帧 `render()`)。 |
| 12 | 切换几次页面/模型后变慢、白屏或 `WebGL context lost` | GPU 显存(VRAM)泄漏或 CPU-GPU 同步停顿 | `renderer.info.memory` 或 `GPUTask.used_bytes` 单调递增;Trace 含 `GLES2::ReadPixels`/`WaitForCmd` | **反模式**:组件卸载只删了 React/DOM 节点,未调 `.dispose()`;或在渲染循环内调 `gl.readPixels()`/`gl.getError()` 导致 CPU-GPU 同步等待。<br>**改法**:卸载时递归执行 `geometry/material/texture/renderTarget.dispose()`;严禁在循环内调 `getError/readPixels`(拾取或截图改用异步 PBO / `mapAsync`)。 |

---

## 二、分析结论呈现模板（强制结构）

向用户汇报性能分析或优化结果时，按以下结构输出（**无 3D/GPU 信号时第 3 节可简写为一行「无异常」；严禁把无测量数据的猜测写成定论**）：

```markdown
### 1. 现象与测量基线
- **复现场景与规模**: [如: 加载 50MB glTF 模型并旋转相机 / 渲染 5,000 条列表, 60Hz, Production 构建]
- **核心基线指标**: 时间跨度 `X ms` | 主线程忙碌 `X%` | 估算帧率 `X FPS` (P95 帧间隔 `X ms`) | Long Tasks `X 个`

### 2. 主线程与 Web Vitals 诊断
- **时间总账**: Scripting `X ms (X%)` / Rendering `X ms` / Painting `X ms` / GC `X ms`
- **最长任务主导调用链**: `RunTask → FireAnimationFrame → ...` (`X ms @+X ms`)
- **JS 热点函数 (Top 3)**: `函数名 @文件:行号` (`X ms`, 占活跃 `X%`)
- **DOM 布局与交互**: 强制同步布局 `X 次` | LCP `X ms` | CLS (最大会话窗口) `X` | 最慢交互 `X ms [输入延迟 + 处理 + 呈现]`

### 3. GPU / 3D 渲染管线与内存/显存指标
- **rAF 帧预算**: 均值 `X ms` | P95 `X ms` | 超预算帧占比 `X%` | PipelineReporter 掉帧率 `X%`
- **3D 管线耗时**: CrGpuMain `X ms (X%)` | 绘制提交 `X ms` | CPU-GPU 同步等待 `X ms` | Shader 编译 `X ms` | Raycaster 拾取 `X ms` | 纹理解码 `X ms`
- **内存与显存趋势**: JS Heap `起点 → 峰值 → 终点 (净变)` | GPU 显存 (`GPUTask.used_bytes`) `起点 → 峰值 → 终点` | (若有 `renderer.info`: DrawCalls `X`, Triangles `X`, Textures `X`)

### 4. 根因排序与单变量优化方案
1. **[P0 最高优 | 所属层] 一句话现象**
   - **证据**: [具体函数/事件名、耗时 ms、占比、触发次数]
   - **修复方案**: [具体代码级改法]
2. **[P1 次优 | 所属层] ...**

### 5. 单变量验证对比 (执行代码优化后必填,可由 `--compare` 直接生成)
| 指标 | 优化前 (Before) | 优化后 (After) | 归一化变化幅度 |
|---|---|---|---|
| 主线程 Scripting 占比 / rAF P95 | ... | ... | ... |
| 帧率 (FPS) / 掉帧率 | ... | ... | ... |
| JS Heap / GPU 显存峰值 | ... | ... | ... |
```

