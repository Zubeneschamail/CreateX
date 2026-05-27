import {
  createAiModelApiResponse,
  MAX_AI_MODEL_BODY_BYTES,
} from "../src/aiModelApi";

const getRuntimeEnv = () => {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return runtime.process?.env || {};
};

const readRequestJson = async (request: Request) => {
  const contentLength = Number(request.headers.get("content-length") || 0);

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_AI_MODEL_BODY_BYTES
  ) {
    throw new Error("请求内容过长");
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).length > MAX_AI_MODEL_BODY_BYTES) {
    throw new Error("请求内容过长");
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("请求 JSON 无效");
  }
};

const json = (
  payload: Record<string, unknown>,
  statusCode: number,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
    status: statusCode,
  });

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, {
        Allow: "POST",
      });
    }

    try {
      const body = await readRequestJson(request);
      const result = await createAiModelApiResponse(body, getRuntimeEnv());

      return json(result.payload, result.statusCode);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求内容无法读取。";
      const statusCode = message === "请求内容过长" ? 413 : 400;

      return json({ error: message }, statusCode);
    }
  },
};
