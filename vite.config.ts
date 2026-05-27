import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, loadEnv, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  createAiModelApiResponse,
  MAX_AI_MODEL_BODY_BYTES,
} from "./src/aiModelApi";
import type { AiModelEnv } from "./src/aiModelApi";

const readJsonBody = async (request: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";

    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");

      if (Buffer.byteLength(body, "utf8") > MAX_AI_MODEL_BODY_BYTES) {
        reject(new Error("请求内容过长"));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("请求 JSON 无效"));
      }
    });

    request.on("error", reject);
  });

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
) => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
};

const handleAiModelRequest =
  (env: AiModelEnv) =>
  async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if (request.method !== "POST") {
      next();
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await createAiModelApiResponse(body, env);

      sendJson(response, result.statusCode, result.payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求内容无法读取。";
      const statusCode = message === "请求内容过长" ? 413 : 400;

      sendJson(response, statusCode, { error: message });
    }
  };

const creatorXAiApiPlugin = (env: AiModelEnv): Plugin => ({
  configureServer(server) {
    server.middlewares.use("/api/ai-model", handleAiModelRequest(env));
  },
  configurePreviewServer(server) {
    server.middlewares.use("/api/ai-model", handleAiModelRequest(env));
  },
  name: "creatorx-ai-api",
});

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const env: AiModelEnv = { ...process.env, ...fileEnv };

  return {
    plugins: [react(), creatorXAiApiPlugin(env)],
  };
});
