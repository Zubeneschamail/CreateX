import OpenAI from "openai";
import {
  clampAiFaceLimit,
  createAiModelJsonSchema,
} from "./aiSchema";
import {
  AiProvider,
  DEFAULT_AI_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  isAiProvider,
} from "./aiModels";

export const MAX_AI_MODEL_BODY_BYTES = 32_000;

export type AiModelEnv = Record<string, string | undefined>;

export type AiModelApiResponse = {
  payload: Record<string, unknown>;
  statusCode: number;
};

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_FALLBACK_MODELS = [
  "anthropic/claude-sonnet-4.5",
  "google/gemini-2.5-flash",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1-mini",
  "mistralai/mistral-small-3.2-24b-instruct",
  "qwen/qwen3-coder",
  "deepseek/deepseek-v3.2",
  "openai/gpt-5-mini",
];
const AI_MODEL_OUTPUT_TOKEN_LIMIT = 24000;
const LOCAL_SITE_URL = "http://127.0.0.1:5173/";

const MODEL_GENERATION_INSTRUCTIONS = [
  "你是 CreatorX 的几何模型生成器。",
  "生成结构清晰的中高精度几何模型，适合由点、线、面、体组成的建模草图。",
  "坐标范围必须保持在 -5 到 5，Y 轴是高度，XZ 是地面。",
  "模型应居中，底部尽量落在 Y=0，尺寸适合在 10x10 工作区查看。",
  "如果当前选中元素不为空，应优先把这些点、线、面作为位置、尺度或连接关系参考。",
  "除非用户明确要求替换，否则不要假设选中元素会被删除；生成结果应能与当前上下文自然衔接。",
  "拓扑结构必须严格按 points -> edges -> faces -> solids 输出。",
  "每个 edge 必须有唯一 id，例如 e1、e2，并通过两个 point id 定义线段。",
  "每个 face 必须有唯一 id，例如 f1、f2，并通过 edges 字段引用一圈有序 edge id。",
  "face.edges 中相邻 edge 必须共享端点，最后一个 edge 必须回到第一个 edge，形成闭合外轮廓。",
  "不要在 face 内输出 points 字段；程序会从 face.edges 自动还原面顶点顺序。",
  "同一条几何线只创建一个 edge；相邻面共享同一个 edge id，不要重复创建重合线段。",
  "不要把对角线、辅助线或内部线放进 face.edges；face.edges 只包含该面的边界线。",
  "solids 必须通过 face id 引用组成自己的闭合外壳。",
  "当用户要求立方体、金字塔、棱柱、房子、球体或任何三维对象时，应输出对应 solids；开放曲面或单张面才使用空 solids。",
  "圆、圆柱、圆锥、拱形、轮子、球体等曲面结构必须用分段边界表达，不要只用四边形粗略代替。",
  "门、窗、烟囱、屋檐、凹槽、台阶、倒角等局部结构应建成独立的点线面，而不是只写在 summary 里。",
  "不要为了增加数量切碎完全平直且没有结构意义的大面；精细度应该服务于轮廓、比例和局部特征。",
  "立方体参考拓扑：8 个 points、12 个 edges、6 个 faces、1 个 solid；更复杂物体应明显高于这个数量。",
  "不要输出解释文字，只返回符合 JSON Schema 的数据。",
].join("\n");

type AiDetailLevel = "standard" | "high" | "ultra";

const DETAIL_LEVEL_INSTRUCTIONS: Record<AiDetailLevel, string> = {
  standard:
    "精细度：标准。适合快速草图；简单体块保持简洁，曲线或圆形使用 8-12 段。",
  high:
    "精细度：高。默认目标是表达清楚轮廓和局部结构；曲线、圆柱和球体使用 16-24 段，复杂物体优先使用 120-420 个点、180-820 条线、60-360 个面。",
  ultra:
    "精细度：极高。尽量表达倒角、孔洞、层级和附属结构；球体可达到约 512 面，复杂模型可接近 schema 上限，但仍保持拓扑闭合和可读。",
};

type OpenRouterContent =
  | string
  | Array<{
      text?: string;
      type?: string;
    }>;

type OpenRouterResponsePayload = {
  choices?: Array<{
    message?: {
      content?: OpenRouterContent;
    };
  }>;
  error?:
    | string
    | {
        code?: number | string;
        message?: string;
      };
  model?: string;
  message?: string;
};

class OpenRouterRequestError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "OpenRouterRequestError";
    this.statusCode = statusCode;
  }
}

const toObjectBody = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const getEnvValue = (env: AiModelEnv, name: string) =>
  typeof env[name] === "string" ? env[name].trim() : "";

const normalizeSiteUrl = (value: string) => {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  return withProtocol.endsWith("/") ? withProtocol : `${withProtocol}/`;
};

const getSiteUrl = (env: AiModelEnv) => {
  const configuredUrl =
    getEnvValue(env, "SITE_URL") || getEnvValue(env, "PUBLIC_SITE_URL");

  if (configuredUrl) {
    return normalizeSiteUrl(configuredUrl);
  }

  const vercelUrl =
    getEnvValue(env, "VERCEL_PROJECT_PRODUCTION_URL") ||
    getEnvValue(env, "VERCEL_URL");

  return vercelUrl ? normalizeSiteUrl(vercelUrl) : LOCAL_SITE_URL;
};

const getProvider = (value: unknown): AiProvider =>
  isAiProvider(value) ? value : DEFAULT_AI_PROVIDER;

const getProviderName = (provider: AiProvider) =>
  provider === "openrouter" ? "OpenRouter" : "OpenAI";

const getApiKey = (body: Record<string, unknown>) => {
  const bodyApiKey =
    typeof body.apiKey === "string" ? body.apiKey.trim() : "";

  return bodyApiKey;
};

const getRequestedModel = (
  provider: AiProvider,
  requestedModel: string,
) => {
  if (requestedModel) {
    return requestedModel;
  }

  if (provider === "openrouter") {
    return DEFAULT_MODEL_BY_PROVIDER.openrouter;
  }

  return DEFAULT_MODEL_BY_PROVIDER.openai;
};

const getDetailLevel = (value: unknown): AiDetailLevel =>
  value === "standard" || value === "ultra" ? value : "high";

const createUserPrompt = (
  prompt: string,
  currentScene: string,
  selectionContext: string,
  detailLevel: AiDetailLevel,
  faceLimit: number,
) =>
  [
    `用户想生成的模型：${prompt}`,
    DETAIL_LEVEL_INSTRUCTIONS[detailLevel],
    `AI 面数上限：最多生成 ${faceLimit} 个 faces，solids 引用的 faces 总数也不能超过这个上限。`,
    `当前场景统计：${currentScene}`,
    `当前选中元素上下文：${selectionContext}`,
  ].join("\n");

const stripJsonFence = (value: string) =>
  value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const getOpenRouterErrorMessage = (payload: OpenRouterResponsePayload) => {
  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (payload.error?.message) {
    return payload.error.message;
  }

  return payload.message;
};

const getOpenRouterOutputText = (payload: OpenRouterResponsePayload) => {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text)
      .filter(Boolean)
      .join("");
  }

  return "";
};

const getOpenRouterCandidateModels = (requestedModel: string) => {
  const candidates = [requestedModel, ...OPENROUTER_FALLBACK_MODELS]
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(candidates)];
};

const shouldTryOpenRouterFallback = (error: unknown) => {
  if (
    error instanceof OpenRouterRequestError &&
    (error.statusCode === 401 || error.statusCode === 402)
  ) {
    return false;
  }

  const message = error instanceof Error ? error.message : "";

  return /terms of service|prohibited|no endpoints|no allowed providers|provider returned|structured|json|schema/i.test(
    message,
  );
};

const generateWithOpenAi = async (
  apiKey: string,
  model: string,
  prompt: string,
  currentScene: string,
  selectionContext: string,
  detailLevel: AiDetailLevel,
  faceLimit: number,
) => {
  const client = new OpenAI({ apiKey });
  const schema = createAiModelJsonSchema(faceLimit);
  const aiResponse = await client.responses.create({
    input: [
      {
        role: "user",
        content: createUserPrompt(
          prompt,
          currentScene,
          selectionContext,
          detailLevel,
          faceLimit,
        ),
      },
    ],
    instructions: MODEL_GENERATION_INSTRUCTIONS,
    max_output_tokens: AI_MODEL_OUTPUT_TOKEN_LIMIT,
    model,
    text: {
      format: {
        name: "creatorx_model",
        schema,
        strict: true,
        type: "json_schema",
      },
      verbosity: "medium",
    },
  });

  if (!aiResponse.output_text) {
    throw new Error("AI 没有返回模型数据。");
  }

  return {
    model: JSON.parse(aiResponse.output_text),
    modelId: model,
  };
};

const requestOpenRouterModel = async (
  apiKey: string,
  model: string,
  prompt: string,
  currentScene: string,
  selectionContext: string,
  detailLevel: AiDetailLevel,
  faceLimit: number,
  siteUrl: string,
) => {
  const schema = createAiModelJsonSchema(faceLimit);
  const upstreamResponse = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    body: JSON.stringify({
      max_tokens: AI_MODEL_OUTPUT_TOKEN_LIMIT,
      messages: [
        {
          content: MODEL_GENERATION_INSTRUCTIONS,
          role: "system",
        },
        {
          content: createUserPrompt(
            prompt,
            currentScene,
            selectionContext,
            detailLevel,
            faceLimit,
          ),
          role: "user",
        },
      ],
      model,
      provider: {
        require_parameters: true,
      },
      response_format: {
        json_schema: {
          name: "creatorx_model",
          schema,
          strict: true,
        },
        type: "json_schema",
      },
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": siteUrl,
      "X-OpenRouter-Experimental-Metadata": "enabled",
      "X-Title": "CreatorX",
    },
    method: "POST",
  });
  const responseText = await upstreamResponse.text();
  let payload: OpenRouterResponsePayload = {};

  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }

  if (!upstreamResponse.ok) {
    const message =
      getOpenRouterErrorMessage(payload) ||
      responseText.slice(0, 240) ||
      "OpenRouter 请求失败。";
    throw new OpenRouterRequestError(message, upstreamResponse.status);
  }

  const outputText = stripJsonFence(getOpenRouterOutputText(payload));

  if (!outputText) {
    throw new Error("OpenRouter 没有返回模型数据。");
  }

  let parsedModel: unknown;

  try {
    parsedModel = JSON.parse(outputText);
  } catch {
    throw new Error(`模型 ${model} 返回的 JSON 无法解析。`);
  }

  return {
    model: parsedModel,
    modelId: typeof payload.model === "string" ? payload.model : model,
  };
};

const generateWithOpenRouter = async (
  apiKey: string,
  model: string,
  prompt: string,
  currentScene: string,
  selectionContext: string,
  detailLevel: AiDetailLevel,
  faceLimit: number,
  siteUrl: string,
) => {
  const failures: string[] = [];
  const candidateModels = getOpenRouterCandidateModels(model);

  for (const candidateModel of candidateModels) {
    try {
      return await requestOpenRouterModel(
        apiKey,
        candidateModel,
        prompt,
        currentScene,
        selectionContext,
        detailLevel,
        faceLimit,
        siteUrl,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "OpenRouter 请求失败。";
      failures.push(`${candidateModel}: ${message}`);

      if (!shouldTryOpenRouterFallback(error)) {
        throw new Error(`OpenRouter 请求失败：${message}`);
      }
    }
  }

  throw new Error(
    `OpenRouter 请求失败：当前模型和备用模型都不可用。最后错误：${failures[failures.length - 1] || "未知错误"}`,
  );
};

export const createAiModelApiResponse = async (
  rawBody: unknown,
  env: AiModelEnv,
): Promise<AiModelApiResponse> => {
  try {
    const body = toObjectBody(rawBody);
    const provider = getProvider(body.provider);
    const apiKey = getApiKey(body);
    const prompt =
      typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
    const requestedModel =
      typeof body.model === "string" ? body.model.trim().slice(0, 80) : "";
    const detailLevel = getDetailLevel(body.detailLevel);
    const faceLimit = clampAiFaceLimit(body.faceLimit);
    const model = getRequestedModel(provider, requestedModel);

    if (!apiKey) {
      return {
        payload: {
          error: `请先在设置里填写 ${getProviderName(provider)} API Key。`,
        },
        statusCode: 400,
      };
    }

    if (!prompt) {
      return {
        payload: { error: "请输入模型描述。" },
        statusCode: 400,
      };
    }

    const currentScene =
      typeof body.currentScene === "object" && body.currentScene !== null
        ? JSON.stringify(body.currentScene)
        : "{}";
    const selectionContext =
      typeof body.selectionContext === "object" &&
      body.selectionContext !== null
        ? JSON.stringify(body.selectionContext).slice(0, 8000)
        : "{}";
    const result =
      provider === "openrouter"
        ? await generateWithOpenRouter(
            apiKey,
            model,
            prompt,
            currentScene,
            selectionContext,
            detailLevel,
            faceLimit,
            getSiteUrl(env),
          )
        : await generateWithOpenAi(
            apiKey,
            model,
            prompt,
            currentScene,
            selectionContext,
            detailLevel,
            faceLimit,
          );

    return {
      payload: {
        ...result,
        provider,
      },
      statusCode: 200,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI 生成模型时发生错误。";

    return {
      payload: { error: message },
      statusCode: 500,
    };
  }
};
