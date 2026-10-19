# 证件照分割模型实测对比（MODNet photographic vs RMBG-1.4）

本文件记录 Task 1 的实测结果，用于决定后续 Task 6 / Task 8 / Task 9 的默认档位与预处理方式。
所有数值均由 `scripts/evaluate-photographic-matte.cjs` 在本机 CPU（onnxruntime-node）上真实跑出，
未使用任何估算值。

## 样张

| 编号 | 样张 | 尺寸 | 说明 |
| --- | --- | --- | --- |
| A | 「黑帽子 + 暗背景」自拍（本地样本） | 1280×1706 | 项目规范里指的同类低对比样张：黑帽子、深色背景、暗绿 T 恤，衣服暗部与背景亮度接近。原始文件未入库，复现命令见下文。 |
| B | `artifacts/sample-portrait.jpg`（爱因斯坦） | 960×1280 | 仓库内已有的人像样张，灰度高对比，用作第二组对照。 |
| C | 白底证件照（本地样本） | 480×640 | 常规白底证件照，用作干净背景对照。 |
| D | 参考仓库 `图片.jpg` | 1920×699 | **不是人像**，而是一张桌面软件截图（见下文说明），不能作为 photographic 的等价样张。 |

> D 的实测：photographic 前景占比 0.37%、alpha p95=0.001（模型基本没有找到人），RMBG-1.4 前景
> 占比 36.67%（把界面当成前景）。这两组数字只说明「该图不是人像」，不能用于模型对比，因此下文的
> 结论表不采用 D。Task 1 brief 里「用参考仓库 `图片.jpg` 作为等价低对比样本」的假设与实际文件不符。

## 评测方法

脚本对同一张图分别运行三个模型，统计 alpha 分布、半透明像素占比、以及「被前景包围的背景洞」
（4 邻接 flood fill：从边界可达的背景为外部背景，剩余的非前景像素即为洞），并按垂直三分带输出
alpha 中位数与前景占比。

- **photographic**：`docker/models/modnet/modnet_photographic.onnx`（25,969,398 B，sha256
  `5069a5e3…2ec3a102ae`，与参考仓库 `pictone/models/modnet_photographic.onnx` 完全一致）。
  - `512 contain`：等比缩放 + 黑边填充到 512×512（brief 指定的口径）。
  - `refpipe`：参考实现 `pictone/matting.py` 的口径——长边缩到 512、保持长宽比、宽高向下取 32 的
    倍数、**不补边**（A 图得到 384×512）。
- **RMBG-1.4 fp16 / fp32**：`docker/models/rmbg/1.4/onnx/model{,_fp16}.onnx`，1024×1024，
  `mean=0.5 / std=1.0`；输出已过 sigmoid，只在值域越界时才补 sigmoid，与 transformers.js
  `background-removal` pipeline 一致。
- **通用 MODNet**：`apps/api/models/modnet.onnx`，项目现网口径 256×256 `fill`（拉伸）。

复现命令（Windows Git Bash / PowerShell 均可）：

```bash
# 主结论（黑帽子 + 暗背景，参考实现口径）
node scripts/evaluate-photographic-matte.cjs <A.jpg> --all --refpipe --dump artifacts/screenshots/id-photo-matte/final/refpipe

# brief 指定的 512 contain 口径
node scripts/evaluate-photographic-matte.cjs <A.jpg> --all --dump artifacts/screenshots/id-photo-matte/final/contain

# 其余样张
node scripts/evaluate-photographic-matte.cjs artifacts/sample-portrait.jpg --all --refpipe
node scripts/evaluate-photographic-matte.cjs <C.jpg> --all --refpipe
```

## 主表：样张 A（黑帽子 + 暗背景）

| 指标 | photographic (512 contain) | photographic (refpipe，无补边) | RMBG-1.4 fp16 (1024) | 通用 MODNet (256 fill) |
| --- | --- | --- | --- | --- |
| alpha p05（全图） | 0.000 | 0.000 | 0.000 | 0.000 |
| alpha p50（全图） | 0.000 | 1.000 | 1.000 | 1.000 |
| alpha p95（全图） | 1.000 | 1.000 | 1.000 | 1.000 |
| 半透明像素占比（0.02–0.98） | 4.42% | 3.68% | 1.97% | 2.42% |
| 前景占比（alpha>0.5） | 42.99% | 58.80% | 58.39% | 59.60% |
| 洞像素总数 | 1524 | 0 | 0 | 7 |
| 洞占前景比例 | 1.35% | 0.00% | 0.00% | 0.02% |
| 最大单洞 | 1176 px（人脸/眼睛区，bbox 241,129 至 273,178） | — | — | 7 px |
| **衣服是否破洞** | **是**（衣服区 2 个洞：243 px + 104 px，bbox 分别约 196,387 与 219,398） | **否** | **否** | **否** |
| 帽子是否实心 | 是（帽子区域无洞；同图的大洞在人脸/眼睛处） | 是 | 是 | 是（帽檐左缘略有锯齿） |
| 推理耗时（CPU，单次） | 226 ms | 192 ms | 1100 ms（fp32 808 ms） | 129 ms |

> 全图 p50 会被补边/背景稀释：photographic 512 contain 的图有 32% 面积是黑边，p50=0 主要来自黑边，
> 不代表人物区域是透明的。人物区域的判断请看下面的 ROI 统计与洞检测。

### 衣服/帽子 ROI 定量（样张 A）

ROI 按源图坐标固定：帽子织物区 `x 480–760, y 245–345`，衣服区 `x 320–953, y 1216–1649`，
换算到各模型输入分辨率后统计。

| 指标 | photographic 512 contain | photographic refpipe | RMBG fp16 | 通用 MODNet 256 fill |
| --- | --- | --- | --- | --- |
| 衣服区 alpha p05 | 0.361 | 0.969 | 1.000 | 1.000 |
| 衣服区 alpha p50 | 1.000 | 1.000 | 1.000 | 1.000 |
| 衣服区 alpha≥0.9 占比 | 86.72% | 99.55% | 100.00% | 100.00% |
| 衣服区 alpha<0.5 占比 | 6.23% | 0.00% | 0.00% | 0.00% |
| 帽子织物区 alpha≥0.9 占比 | 40.24% | 40.52% | 33.25% | 51.59% |

帽子 ROI 包含帽体外围的暗背景，因此「alpha≥0.9 占比」只有 30–50%；该指标只用于横向对比，
不能单独当作「帽子实心」的判据。帽子是否实心以洞检测（帽子区域内洞数 = 0）与合成图肉眼核对为准。

## 其他样张的洞检测

| 样张 | photographic 512 contain | photographic refpipe | RMBG fp16 | 通用 MODNet 256 fill |
| --- | --- | --- | --- | --- |
| A 黑帽子暗背景 | 1524 px / 1.35% 前景 | 0 px | 0 px | 7 px |
| B 爱因斯坦（灰度高对比） | 732 px / 0.49%（发丝间隙，非衣服） | 726 px / 0.49% | 1156 px / 0.15% | 177 px / 0.36% |
| C 白底证件照 | N/A（样本未纳入本轮 contain 组） | 0 px | 0 px | 0 px |

样张 C 的 refpipe 实测：photographic 半透明占比 2.79%、RMBG 1.05%、通用 MODNet 2.14%，三者均无洞。

## 关键发现：破洞来自预处理，不是模型

1. 同一张 A 图、同一份 photographic 权重：
   - 512 contain（等比缩放 + 黑边补成正方形）→ 衣服 2 个洞、人脸/眼睛处 1 个大洞（1176 px）；
   - refpipe（长边 512、保持长宽比、不补边，384×512）→ **0 个洞**。
   - 追加试验：把补边颜色换成灰/白，洞减少到 1136 / 1065 px，但仍存在；直接把图拉伸成 512×512
     （fill）则增至 3123 px。说明触发因素是「补成正方形的黑边」改变了模型对画面内容的判断，
     而不是 photographic 权重本身会在衣服上开洞。
2. `apps/api/models/modnet.onnx`（现网「通用 MODNet」）与 `modnet_photographic.onnx` 在本机
   逐像素输出**完全相同**（256×256 与 384×512 两种输入下 max abs diff = 0），两个文件只是封装
   不同（sha256 不同、体积相差 80 KB）。因此「通用 MODNet 会把衣服开洞」这一历史结论，本质上是
   **256 fill / 旧后处理管线**的表现，不能归因于模型权重差异。
3. 现有服务端后处理 `refinePortraitAlphaBytes`（黑点 72 / 白点 144 / gamma 0.55）会把半透明
   像素二值化。对 contain 口径：洞从 1524 降到 1334 px（仍然破洞，肉眼可见蓝底）；对 refpipe
   口径：本来 0 洞，细化后出现 16 px 的 1 像素级噪点洞（0.01% 前景），可忽略。**后处理不能修复
   补边导致的破洞。**

## 结论

**决定性问题的答案：在参考实现口径（长边 512、保持长宽比、不补边）下，photographic 在「黑帽子 +
暗背景」样张上不会让衣服破洞。** 该样张上 photographic 的洞像素为 0，衣服区 alpha p05 = 0.969、
alpha<0.5 占比 0.00%，与 RMBG-1.4 持平。

但 brief 采用的 `512 contain`（补黑边成正方形）会稳定复现破洞（衣服 347 px + 人脸 1176 px），
因此后续实现**必须沿用参考实现的预处理**，不能照搬 Task 9 里 `letterboxResize` 的「补边到 512×512」
方案——那正是本次实测中唯一会破洞的路径。

据此对下游任务的建议：

- **Task 6 / Task 8 / Task 9**：photographic 作为两端唯一默认档；预处理改为「长边 512、宽高向下取
  32 的倍数、不补边（动态宽高输入）」，alpha 直接按源图比例回贴，不做正方形 letterbox。
  `letterboxResize` 若保留，只能用于「不参与推理的显示/裁剪」，不能用于模型输入。
- **RMBG-1.4**：本轮实测没有质量优势上的必要性（洞、衣服/帽子实心均与 photographic refpipe 持平，
  且半透明占比更低只是因为 1024 分辨率更平滑），加上 BRIA 专有许可，建议只保留为紧急回落，
  不作为对用户暴露的高精度档。
- **`highPrecision` 开关**：photographic 只有一个 fp32 权重，不存在 fp16/fp32 或 512/1024 的档位差；
  建议保留开关但映射到同一 photographic 实现（或直接移除档位选择）。若产品坚持保留「更高精度」，
  唯一可用的替代是 RMBG-1.4 fp32（需 WebGPU），代价是许可与 176 MB 下载。
- 通用 `modnet.onnx` 与 photographic 权重等价，服务端回落链可以继续保留，但回落只解决「文件缺失」，
  不解决画质。

## 局限

- 推理耗时是 Windows 本机 CPU（onnxruntime-node）单次结果，未包含模型加载，也不代表浏览器
  WebGPU 的表现。
- 破洞判定基于 alpha>0.5 的连通域；低对比衣服上「alpha 0.1–0.5 的薄雾」不计为洞，但会表现为合成后
  的轻微透底。衣服区 alpha p05 / alpha<0.5 占比已一并给出，供交叉判断。
- 样张 A/B/C 中 A、C 为本地样本，未提交到 Git（涉及真人照片）；按上文命令替换成任意同类型样张即可复现。
- 样张 D（参考仓库 `图片.jpg`）不是人像，本文件不采用其数值作为对比结论。
