export type AiProvider = "openai" | "openrouter";

export const AI_PROVIDER_OPTIONS: Array<{
  description: string;
  label: string;
  value: AiProvider;
}> = [
  {
    description: "直接使用 OpenAI API Key 调用 OpenAI Responses API",
    label: "OpenAI",
    value: "openai",
  },
  {
    description: "使用 OpenRouter API Key 调用 OpenAI 兼容接口",
    label: "OpenRouter",
    value: "openrouter",
  },
];

export const DEFAULT_AI_PROVIDER: AiProvider = "openai";

export const DEFAULT_MODEL_BY_PROVIDER: Record<AiProvider, string> = {
  openai: "gpt-5-mini",
  openrouter: "openai/gpt-5-mini",
};

export const MODEL_OPTIONS_BY_PROVIDER: Record<
  AiProvider,
  Array<{
    description: string;
    label: string;
    value: string;
  }>
> = {
  openai: [
    {
      description: "推荐，速度和质量比较均衡",
      label: "GPT-5 mini",
      value: "gpt-5-mini",
    },
    {
      description: "质量更高，成本和延迟更高",
      label: "GPT-5.2",
      value: "gpt-5.2",
    },
    {
      description: "更便宜更快，适合简单几何",
      label: "GPT-5 nano",
      value: "gpt-5-nano",
    },
    {
      description: "非推理模型，适合稳定结构化输出",
      label: "GPT-4.1 mini",
      value: "gpt-4.1-mini",
    },
  ],
  openrouter: [
    {
      description: "推荐，沿用 OpenAI 模型能力，并通过 OpenRouter 计费",
      label: "OpenAI GPT-5 mini",
      value: "openai/gpt-5-mini",
    },
    {
      description: "适合稳定 JSON 输出的轻量 OpenAI 模型",
      label: "OpenAI GPT-4.1 mini",
      value: "openai/gpt-4.1-mini",
    },
    {
      description: "便宜快速，适合几何草图和稳定结构化输出",
      label: "OpenAI GPT-4o mini",
      value: "openai/gpt-4o-mini",
    },
    {
      description: "通用能力更强，适合复杂几何和颜色描述",
      label: "OpenAI GPT-4o",
      value: "openai/gpt-4o",
    },
    {
      description: "速度较快，适合快速生成简单几何草图",
      label: "Google Gemini 2.5 Flash",
      value: "google/gemini-2.5-flash",
    },
    {
      description: "质量更高，适合更复杂的空间结构",
      label: "Google Gemini 2.5 Pro",
      value: "google/gemini-2.5-pro",
    },
    {
      description: "预览模型，速度和质量均衡，可作为备用选择",
      label: "Google Gemini 3 Flash Preview",
      value: "google/gemini-3-flash-preview",
    },
    {
      description: "质量较高，适合更复杂的模型描述",
      label: "Anthropic Claude Sonnet 4.5",
      value: "anthropic/claude-sonnet-4.5",
    },
    {
      description: "高质量模型，适合多面体和复杂组合结构",
      label: "Anthropic Claude Opus 4.1",
      value: "anthropic/claude-opus-4.1",
    },
    {
      description: "欧洲模型，结构化输出支持较好",
      label: "Mistral Large 2411",
      value: "mistralai/mistral-large-2411",
    },
    {
      description: "轻量 Mistral 模型，适合快速低成本尝试",
      label: "Mistral Small 3.2 24B",
      value: "mistralai/mistral-small-3.2-24b-instruct",
    },
    {
      description: "代码和结构化任务表现较强，适合输出点线面 JSON",
      label: "Qwen3 Coder",
      value: "qwen/qwen3-coder",
    },
    {
      description: "推理能力较强，适合稍复杂的几何组合",
      label: "DeepSeek V3.2",
      value: "deepseek/deepseek-v3.2",
    },
  ],
};

export const isAiProvider = (value: unknown): value is AiProvider =>
  value === "openai" || value === "openrouter";

export const isKnownModelForProvider = (
  provider: AiProvider,
  model: string,
) =>
  MODEL_OPTIONS_BY_PROVIDER[provider].some((option) => option.value === model);
