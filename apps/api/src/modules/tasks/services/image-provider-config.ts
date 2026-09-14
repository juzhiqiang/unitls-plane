import { z } from 'zod';

/** provider 与生成标识共用同一个默认模型,避免 EXIF 记的模型与实际请求不一致。 */
export const DEFAULT_AI_IMAGE_MODEL = 'gpt-image-1';

/**
 * 来源能力位。
 *
 * `generate` = 文生图,`edit` = 图生图/多图融合,`inpaint` = 蒙版局部重绘
 * (依赖 /v1/images/edits 的 mask 字段,wan 系网关没有;kmage 的 gpt-image-2 实测可用)。
 * inpaint 不进默认值:支持的来源显式声明,前端据此决定编辑器入口是否出现。
 */
export const imageProviderCapabilityEnum = z.enum([
  'generate',
  'edit',
  'inpaint',
]);

/**
 * 图生图的上游调用方式。OpenAI 兼容网关在这一点上并不统一:
 *
 * - `multipart`:标准 OpenAI / New API 形态,POST /v1/images/edits,参考图走 multipart 文件字段。
 * - `generations_ref`:复用 /v1/images/generations,参考图放在 JSON body 的数组字段里
 *   (字段名由 refImagesField 配置,kmage 用 reference_images)。
 *
 * 文生图对所有来源都是同一个端点,只有图生图需要分支。
 */
export const imageProviderEditTransportEnum = z.enum([
  'multipart',
  'generations_ref',
]);

/**
 * generations_ref 传图时数组元素的编码。
 *
 * `data_url` 带 `data:image/png;base64,` 前缀(kmage 文档给的就是这种),
 * `base64` 是裸 base64。两者都不外发原图元数据:参考图会先过 sharp 转 PNG。
 */
export const imageProviderRefEncodingEnum = z.enum(['data_url', 'base64']);

export const imageProviderResponseFormatEnum = z.enum(['b64_json', 'url']);

/**
 * 请求体里允许省略的可选字段。
 *
 * 我们默认按 OpenAI 的 /v1/images/generations 发全套 size / quality / response_format / n,
 * 但不少网关对请求体做严格校验:多一个它不认识的字段就整个 400(wan 回
 * 「请求包含未知字段」),gpt-image-1 自己也已经不接受 response_format。
 * 出现这种来源时,把对应字段列进 omitBodyFields 即可,不需要改代码。
 *
 * model 与 prompt 不在可省略范围内 —— 少了它们请求本身没有意义。
 */
export const imageProviderOmittableBodyFieldEnum = z.enum([
  'size',
  'quality',
  'response_format',
  'n',
  'background',
]);

/**
 * 来源支持的尺寸列表("auto" 或 "WxH")。
 *
 * 该列表随 providers 端点下发,前端据此决定画面比例 chips 显示哪些档;
 * processor 在请求前用它交叉校验任务里的 size。
 *
 * 默认值刻意不含 "auto":它只是 gpt-image-1 一族的语义,严格校验请求体的
 * 网关(如 wan)收到 "auto" 会整个 400 —— 存量部署不配 sizes 也能照常工作。
 * gpt-image-1 类来源想要「自动」档,在配置里显式加 "auto" 即可。
 * 覆盖 1:1 / 2:3 / 3:2 / 3:4 / 4:3 / 9:16 / 16:9 七档常见比例。
 */
export const imageProviderSizeSchema = z
  .string()
  .trim()
  .regex(/^(auto|\d{2,5}x\d{2,5})$/, 'size must be "auto" or "WxH"');

export const DEFAULT_AI_IMAGE_SIZES = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '864x1152',
  '1152x864',
  '864x1536',
  '1536x864',
] as const;

/**
 * 来源内的单个模型。
 *
 * 模型级声明 capabilities 与 sizes:同一来源(网关)下不同模型的能力与尺寸档位
 * 可以不同(如只有 gpt-image-2 支持 inpaint),前端的能力标签与画面比例档位
 * 都按所选模型显示。
 */
export const imageProviderModelSchema = z
  .object({
    /** 模型名即上游 API 的 model 参数原文,可含空格与大小写(如 "KMage V2")。 */
    name: z.string().trim().min(1).max(64),
    /** 能力声明同旧来源级语义:inpaint 不进默认值,支持的模型显式声明。 */
    capabilities: z
      .array(imageProviderCapabilityEnum)
      .min(1)
      .default(['generate', 'edit'])
      .transform(list => [...new Set(list)]),
    /** 该模型支持的尺寸;默认不含 "auto"(沿用旧默认的理由见 size schema 注释)。 */
    sizes: z
      .array(imageProviderSizeSchema)
      .min(1)
      .default([...DEFAULT_AI_IMAGE_SIZES])
      .transform(list => [...new Set(list)]),
  })
  .strict();

export type ImageProviderModelConfig = z.infer<typeof imageProviderModelSchema>;

/**
 * 单个生图来源(网关)。
 *
 * 只要是 OpenAI 兼容的生图接口,新增来源就是往 AI_IMAGE_PROVIDERS 数组里加一项,
 * 不需要改代码 —— 差异全部落在 editTransport / refImagesField / refImageEncoding /
 * responseFormat 这几个开关上。
 *
 * 模型声明在 models 数组(每项一个模型,含自己的能力与尺寸);同一模型可以出现在
 * 多个来源下 —— 这正是多来源容错路由的基础。
 */
export const imageProviderConfigSchema = z
  .object({
    id: z
      .string()
      .trim()
      .max(64)
      .regex(
        /^[a-z0-9][a-z0-9_-]*$/i,
        'provider id must start with a letter or digit and contain only letters, digits, "-" or "_"'
      ),
    /** 展示名,仅供日志与内部诊断;模型视角的前端不再展示来源名。 */
    label: z.string().trim().min(1).max(64),
    baseUrl: z.string().trim().url(),
    /** 允许缺省:少数自托管网关不校验 Authorization。 */
    apiKey: z.string().trim().min(1).optional(),
    /** 该来源服务的模型列表;至少一个。 */
    models: z.array(imageProviderModelSchema).min(1),
    editTransport: imageProviderEditTransportEnum.default('multipart'),
    refImagesField: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .default('reference_images'),
    refImageEncoding: imageProviderRefEncodingEnum.default('data_url'),
    responseFormat: imageProviderResponseFormatEnum.default('b64_json'),
    /** 见 imageProviderOmittableBodyFieldEnum:严格校验请求体的网关靠这个删字段。 */
    omitBodyFields: z
      .array(imageProviderOmittableBodyFieldEnum)
      .default([])
      .transform(list => [...new Set(list)]),
  })
  .strict();

/**
 * AI_IMAGE_PROVIDERS 的完整形状。
 *
 * 数组第一项是默认来源:任务没带 model(历史任务、单来源部署)时用它。
 */
export const imageProviderConfigsSchema = z
  .array(imageProviderConfigSchema)
  .min(1)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((provider, index) => {
      const key = provider.id.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: `duplicate provider id: ${provider.id}`,
        });
      }
      seen.add(key);

      // 来源内模型名去重(大小写不敏感):"GPT-Image-1" vs "gpt-image-1" 在同一来源
      // 下只会是配置笔误。跨来源同名模型合法,不在这里校验。
      const modelKeys = new Set<string>();
      provider.models.forEach((model, modelIndex) => {
        const modelKey = model.name.toLowerCase();
        if (modelKeys.has(modelKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'models', modelIndex, 'name'],
            message: `duplicate model name in provider ${provider.id}: ${model.name}`,
          });
        }
        modelKeys.add(modelKey);
      });
    });
  });

export type ImageProviderCapability = z.infer<
  typeof imageProviderCapabilityEnum
>;
export type ImageProviderEditTransport = z.infer<
  typeof imageProviderEditTransportEnum
>;
export type ImageProviderRefEncoding = z.infer<
  typeof imageProviderRefEncodingEnum
>;
export type ImageProviderResponseFormat = z.infer<
  typeof imageProviderResponseFormatEnum
>;
export type ImageProviderOmittableBodyField = z.infer<
  typeof imageProviderOmittableBodyFieldEnum
>;
export type ImageProviderConfig = z.infer<typeof imageProviderConfigSchema>;

/** 只读的环境变量视图。不用 NodeJS.ProcessEnv:eslint 的 no-undef 在这里看不到 node 全局。 */
export type ImageProviderEnv = Record<string, string | undefined>;

/** 旧单来源配置回退时用的 id,也是历史任务 providerId 的解析目标。 */
export const LEGACY_PROVIDER_ID = 'default';

/** 模型解析收在一处:用 || 而不是 ?? ,env "设了但为空" 也要回退默认值。 */
export function resolveAiImageModel(
  env: ImageProviderEnv = process.env
): string {
  return env.AI_IMAGE_MODEL || DEFAULT_AI_IMAGE_MODEL;
}

/**
 * 单次上游请求的超时上限。
 *
 * 没有 this 的话,挂死的上游(连上了 TLS、收了请求体,但永远不回响应)会让 fetch
 * 一直挂到 TCP keepalive 介入,worker 整段时间被占死、任务转成 failed 要等很久。
 * 设了上限后这类来源会快速失败成 AI_IMAGE_GENERATION_FAILED,而不是无限期转圈。
 *
 * 默认 180s:实测 openai 兼容来源单张约 54s,留 3 倍余量;再大也仍小于 BullMQ
 * 的 lockDuration(600s),不会撞上 stall。封顶 600000,避免配错成超过锁时长的值。
 */
export function resolveAiImageRequestTimeoutMs(
  env: ImageProviderEnv = process.env
): number {
  const raw = Number(env.AI_IMAGE_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 600000);
  return 180000;
}

/**
 * 解析生图来源配置。
 *
 * 三种情况分得很开:
 * - 配了 AI_IMAGE_PROVIDERS:严格解析,非法就抛错让进程起不来(fail-fast)。配置写错
 *   静默降级成单来源,比启动失败难查得多。
 * - 只配了旧的 AI_IMAGE_*:包装成一个 default 来源(单模型),现网部署零改动。
 * - 都没配:返回空数组,生图功能保持关闭。
 */
export function loadImageProviderConfigs(
  env: ImageProviderEnv = process.env
): ImageProviderConfig[] {
  const raw = env.AI_IMAGE_PROVIDERS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `AI_IMAGE_PROVIDERS is not valid JSON: ${(error as Error).message}`,
        { cause: error }
      );
    }

    const result = imageProviderConfigsSchema.safeParse(parsed);
    if (!result.success) {
      // 只输出路径与原因,不回显 value —— 这个数组里有 apiKey。
      const issues = result.error.issues
        .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      // 旧格式(顶层 model/capabilities/sizes)在新结构下报 "Unrecognized key",
      // 追加一句人话指引,别让运维对着 zod 原文猜。
      const legacy = looksLikeLegacyProviderConfig(parsed)
        ? ' (format changed: declare models under a "models" array per provider, see .env.example)'
        : '';
      throw new Error(`AI_IMAGE_PROVIDERS is invalid: ${issues}${legacy}`);
    }
    return result.data;
  }

  if (!env.AI_IMAGE_BASE_URL?.trim()) return [];

  return imageProviderConfigsSchema.parse([
    {
      id: LEGACY_PROVIDER_ID,
      label: env.AI_IMAGE_LABEL?.trim() || LEGACY_PROVIDER_ID,
      baseUrl: env.AI_IMAGE_BASE_URL,
      ...(env.AI_IMAGE_API_KEY?.trim()
        ? { apiKey: env.AI_IMAGE_API_KEY.trim() }
        : {}),
      models: [
        {
          name: resolveAiImageModel(env),
          capabilities: ['generate', 'edit'],
          sizes: [...DEFAULT_AI_IMAGE_SIZES],
        },
      ],
      editTransport: 'multipart',
      responseFormat:
        env.AI_IMAGE_RESPONSE_FORMAT?.trim() === 'url' ? 'url' : 'b64_json',
    },
  ]);
}

/**
 * 判断解析失败的输入是不是旧版结构(顶层 model/capabilities/sizes)。
 *
 * 只看键名不看值:错误信息不能回显 value(数组里有 apiKey),这里同样只碰键名。
 */
function looksLikeLegacyProviderConfig(parsed: unknown): boolean {
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  const legacyKeys = new Set(['model', 'capabilities', 'sizes']);
  return parsed.some(
    item =>
      typeof item === 'object' &&
      item !== null &&
      Object.keys(item).some(key => legacyKeys.has(key))
  );
}
