import { z } from 'zod';

/** provider 与生成标识共用同一个默认模型,避免 EXIF 记的模型与实际请求不一致。 */
export const DEFAULT_AI_IMAGE_MODEL = 'gpt-image-1';

export const imageProviderCapabilityEnum = z.enum(['generate', 'edit']);

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
]);

/**
 * 单个生图来源。
 *
 * 只要是 OpenAI 兼容的生图接口,新增来源就是往 AI_IMAGE_PROVIDERS 数组里加一项,
 * 不需要改代码 —— 差异全部落在 editTransport / refImagesField / refImageEncoding /
 * responseFormat 这几个开关上。
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
    /** 展示给用户的名字。会下发到前端,不要写成含密钥或内部主机名的字符串。 */
    label: z.string().trim().min(1).max(64),
    baseUrl: z.string().trim().url(),
    /** 允许缺省:少数自托管网关不校验 Authorization。 */
    apiKey: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).default(DEFAULT_AI_IMAGE_MODEL),
    capabilities: z
      .array(imageProviderCapabilityEnum)
      .min(1)
      .default(['generate', 'edit'])
      .transform(list => [...new Set(list)]),
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
 * 数组第一项是默认来源:任务没带 providerId(历史任务、单来源部署)时用它。
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

/** 旧单来源配置回退时用的 id,也是 GET /tasks/image-generate/providers 里的第一项。 */
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
 * - 只配了旧的 AI_IMAGE_*:包装成一个 default 来源,现网部署零改动。
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
      throw new Error(`AI_IMAGE_PROVIDERS is invalid: ${issues}`);
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
      model: resolveAiImageModel(env),
      capabilities: ['generate', 'edit'],
      editTransport: 'multipart',
      responseFormat:
        env.AI_IMAGE_RESPONSE_FORMAT?.trim() === 'url' ? 'url' : 'b64_json',
    },
  ]);
}
