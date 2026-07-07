# 证件照生成设计

## 背景

Utils-Plane 当前已经提供图片压缩、格式转换、水印、PDF、字体、文件管理和异步任务能力。图片工具以本地优先体验为主，服务端已有 `image-queue`、`ImageProcessor`、`ImageService` 和 `sharp` 图片处理能力。

本设计新增图片工具「证件照生成」，能力描述为：自动换底色、裁剪标准尺寸。设计选择混合方案：前端负责上传、预览、规格选择和微调，服务端负责高质量人像分割、背景合成、标准尺寸裁剪和最终文件输出。

## 目标

- 在图片工具目录新增「证件照生成」入口，路径为 `/image/id-photo`。
- 支持上传单人照片，生成标准证件照。
- 支持常用规格预设，例如一寸、二寸、小一寸、护照照。
- 支持白、蓝、红背景，以及受校验约束的自定义背景色。
- 支持用户微调头像位置和缩放，降低自动裁剪失败率。
- 最终输出通过现有任务、文件、下载和历史记录体系管理。

## 非目标

- 第一版不做复杂发丝手动精修画笔。
- 第一版不做多规格批量生成 zip，但保留配置扩展空间。
- 第一版不承诺覆盖所有国家签证照片规范，只内置少量通用预设。
- 第一版不新增独立文件存储或任务系统。

## 推荐方案

采用「前端即时体验 + 后端高清生成」。

- 前端提供上传、裁剪框、背景色、规格选择和结果轮询。
- 后端新增 `image_id_photo` 任务类型，沿用 `image-queue`。
- Processor 下载原图后，先做人像分割，再用 `sharp` 合成背景并裁剪到标准尺寸。
- 输出文件保存到 MinIO，任务记录保存到现有 `tasks` 表。

不选择纯前端方案的原因是人像抠图质量和移动端性能不稳定。不选择第三方 API 作为默认路线的原因是隐私、成本、离线部署和可控性较差。

## 前端设计

新增页面：

- `apps/web/src/app/[locale]/(app)/image/id-photo/page.tsx`

复用组件：

- `ToolPageShell`
- `ToolTrustStrip`
- `ToolStepRail`
- `FileDropzone`
- `ResultPanel`
- `FailureRecoveryPanel`

新增或扩展组件：

- `IdPhotoPresetSelect`：选择证件照规格。
- `IdPhotoBackgroundPicker`：选择白、蓝、红或自定义背景色。
- `IdPhotoCropEditor`：控制头像缩放和位置。
- `IdPhotoPreview`：展示前端预览图和最终结果状态。

页面状态：

```ts
type IdPhotoOptions = {
  preset: 'one_inch' | 'two_inch' | 'small_one_inch' | 'passport';
  backgroundColor: string;
  outputType: 'image/jpeg' | 'image/png';
  crop?: {
    x: number;
    y: number;
    scale: number;
  };
};
```

前端只把预览作为交互反馈，不把预览结果当作最终质量承诺。最终文件以服务端任务结果为准。

## 工具元数据与文案

更新：

- `apps/web/src/lib/tools/tool-metadata.ts`
- `apps/web/messages/zh.json`
- `apps/web/messages/en.json`

新增工具元数据：

- key：`imageIdPhoto`
- href：`/image/id-photo`
- processing：`server`
- category：图片转换或图片增强类目，具体命名沿用现有目录分组风格。

中文文案建议：

- 标题：`证件照生成`
- 描述：`自动换底色并裁剪为常用证件照尺寸。`

英文文案建议：

- Title：`ID Photo Generator`
- Description：`Change backgrounds and crop photos to standard ID sizes.`

## 后端设计

新增任务类型：

```ts
type TaskType = 'image_id_photo';
```

需要同步更新：

- `packages/validators/src/tasks.ts`
- `packages/db/src/schema/tasks.ts`
- `apps/api/src/modules/tasks/dto/tasks.dto.ts`
- `apps/api/src/modules/tasks/tasks.service.ts`
- `apps/api/src/modules/tasks/processors/image.processor.ts`
- `apps/api/openapi.json`
- `packages/api-client`
- `apps/web/src/hooks/api/types.ts`
- 任务列表里的类型标签和分类逻辑

数据库 enum 需要新增 migration：

```sql
ALTER TYPE "public"."task_type" ADD VALUE 'image_id_photo';
```

任务配置：

```ts
type IdPhotoTaskConfig = {
  preset: 'one_inch' | 'two_inch' | 'small_one_inch' | 'passport';
  backgroundColor: string;
  outputType: 'image/jpeg' | 'image/png';
  dpi: 300;
  crop?: {
    x: number;
    y: number;
    scale: number;
  };
};
```

## 规格配置

新增共享配置模块，建议放在 `packages/validators` 或 `packages/utils` 中，由前后端共同使用。

```ts
type IdPhotoPreset = {
  key: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  labelKey: string;
  defaultBackground: string;
  headRatioRange: [number, number];
  faceCenterYRatio: number;
};
```

第一版预设：

| key              | 尺寸像素     | 默认 DPI | 说明   |
| ---------------- | ------------ | -------- | ------ |
| `one_inch`       | `295 x 413`  | `300`    | 一寸   |
| `two_inch`       | `413 x 626`  | `300`    | 二寸   |
| `small_one_inch` | `260 x 378`  | `300`    | 小一寸 |
| `passport`       | `413 x 531`  | `300`    | 护照照 |

第一版按上表作为产品内置通用尺寸，不把它们标记为特定国家、考试或签证标准。后续如扩展到具体场景，需要新增独立 preset，避免把地区规范混入通用尺寸。

## 图片处理链路

Processor 流程：

1. 下载输入文件。
2. 校验图片格式和尺寸。
3. 运行人像检测和分割，生成 alpha mask。
4. 如有前端 crop 参数，先按 crop 裁剪；否则按人脸位置自动估算裁剪区域。
5. 使用 `sharp` 将人物图层与纯色背景合成。
6. 按 preset 输出固定像素尺寸和 DPI metadata。
7. 保存输出文件，更新 task 结果。

服务封装建议：

- `IdPhotoService`：编排证件照生成。
- `PortraitSegmentationService`：封装人像分割模型调用。
- `IdPhotoPresetService`：读取和校验规格配置。

人像分割实现第一版可以使用本地模型封装，保持接口稳定：

```ts
type PortraitSegmentationService = {
  segment(input: Buffer): Promise<{
    mask: Buffer;
    bounds?: { x: number; y: number; width: number; height: number };
    faceCount?: number;
  }>;
};
```

这样后续可以替换具体模型，而不影响任务和页面。

## 错误处理

新增业务错误码：

- `NO_FACE_DETECTED`：未检测到人脸。
- `MULTIPLE_FACES_DETECTED`：检测到多人。
- `FACE_TOO_SMALL`：人脸占比过小。
- `SEGMENTATION_FAILED`：人像分割失败。
- `UNSUPPORTED_PRESET`：不支持的规格。
- `INVALID_BACKGROUND_COLOR`：背景色非法。
- `ID_PHOTO_RENDER_FAILED`：最终渲染失败。

前端恢复建议：

- 未检测到人脸：提示上传正面、清晰、单人照片。
- 多人照片：提示裁剪或更换为单人照片。
- 人脸过小：提示使用近景照片。
- 分割失败：允许重试，或仅输出手动裁剪的纯背景版本。
- 配置非法：表单层即时拦截，并以后端错误作为兜底。

## 安全与限制

- 沿用现有匿名和登录用户上传大小限制。
- 只接受图片 MIME 类型和白名单扩展名。
- 自定义背景色只接受 hex 颜色，例如 `#ffffff`。
- 不把人像分割模型错误栈直接返回给客户端。
- 匿名文件仍按现有过期策略清理。

## 测试计划

前端测试：

- 工具元数据包含 `/image/id-photo`。
- 图片工具目录展示证件照入口。
- 页面可选择规格、背景色和输出格式。
- 创建任务时 payload 包含 `image_id_photo` 和合法 config。
- 后端错误码能映射为可理解的恢复提示。

共享校验测试：

- preset 只能取白名单值。
- backgroundColor 必须是合法 hex。
- crop.scale、crop.x、crop.y 有合理范围。
- outputType 只能是 JPEG 或 PNG。

API 测试：

- `image_id_photo` 会路由到 `image-queue`。
- DTO 拒绝非法 preset 和背景色。
- OpenAPI 导出包含新任务类型。

Processor 测试：

- 固定样例图能输出指定尺寸。
- 输出 mime 和扩展名正确。
- 背景像素颜色符合选择值。
- 无人脸图片返回 `NO_FACE_DETECTED`。
- 分割异常返回 `SEGMENTATION_FAILED`。

## 实施影响

需要新增依赖或模型资产。实施前需要确认人像分割模型方案，优先选择可本地部署、可离线构建、接口稳定的方案。模型文件不应直接混入业务源码；应放入明确的 assets/model 目录或通过构建步骤引入，并在 Docker 构建中显式处理。

API 修改后需要重新导出 OpenAPI，并同步 `packages/api-client` 类型。

数据库新增 task enum 后需要生成并执行 Drizzle migration。

## 实施前置决策

- 人像分割默认按 `onnxruntime-node + 本地 ONNX 人像分割模型` 做技术验证，封装在 `PortraitSegmentationService` 后面；如果 Bun/Nest/Docker 兼容性不稳定，降级为独立 Python sidecar，任务接口和前端不变。
- 第一版不支持透明背景 PNG，只输出纯色背景；PNG 仅作为无损格式选项。
- 第一版只做通用尺寸预设，不加入国家、考试或签证分类。

推荐第一版先做通用预设和纯色背景，透明背景与更细分类作为后续增强。
