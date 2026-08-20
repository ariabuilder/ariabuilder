import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { InferenceBackendId } from "../../shared/agent";
import { loadProviderCredentials } from "../secrets";
import {
  getOpencodeBaseUrlForPlan,
  getOpencodeTransport,
  opencodeApiModelId,
  OPENROUTER_API_BASE,
  resolveOpencodeRequestModel,
} from "./opencodeProviders";

export interface ResolveLanguageModelInput {
  userData: string;
  backend: InferenceBackendId;
  instanceId: string;
  modelId: string;
  baseUrl?: string;
}

function validatedCompatibleBaseUrl(raw: string | undefined): string {
  if (!raw?.trim()) {
    throw new Error("OpenAI-compatible base URL is not configured");
  }
  const url = new URL(raw.trim());
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "OpenAI-compatible URLs must use HTTPS; HTTP is allowed only for localhost",
    );
  }
  return url.toString().replace(/\/$/, "");
}

export async function resolveLanguageModel(
  input: ResolveLanguageModelInput,
): Promise<LanguageModel> {
  const modelId = input.modelId.trim();
  if (!modelId) {
    throw new Error("Model id is required");
  }

  if (input.backend === "opencode") {
    const credentials = loadProviderCredentials(input.userData, "opencode", input.instanceId);
    if (!credentials) {
      throw new Error("OpenCode credentials are not configured");
    }

    const plan = resolveOpencodeRequestModel(modelId).plan;
    const requestModelId = opencodeApiModelId(modelId);
    const baseURL = getOpencodeBaseUrlForPlan(plan);

    switch (getOpencodeTransport(modelId)) {
      case "openai-responses": {
        const opencode = createOpenAI({
          apiKey: credentials.apiKey,
          baseURL,
        });
        return opencode.responses(requestModelId) as unknown as LanguageModel;
      }
      case "anthropic-messages": {
        const opencode = createAnthropic({
          apiKey: credentials.apiKey,
          baseURL,
        });
        return opencode(requestModelId) as unknown as LanguageModel;
      }
      case "google-generative-ai": {
        const opencode = createGoogleGenerativeAI({
          apiKey: credentials.apiKey,
          baseURL,
        });
        return opencode(requestModelId) as unknown as LanguageModel;
      }
      case "openai-compatible": {
        const opencode = createOpenAI({
          apiKey: credentials.apiKey,
          baseURL,
        });
        return opencode.chat(requestModelId) as unknown as LanguageModel;
      }
    }
  }

  if (input.backend === "openai") {
    const credentials = loadProviderCredentials(input.userData, "openai", input.instanceId);
    if (!credentials) {
      throw new Error("OpenAI credentials are not configured");
    }
    const openai = createOpenAI({ apiKey: credentials.apiKey });
    return openai(modelId);
  }

  if (input.backend === "anthropic") {
    const credentials = loadProviderCredentials(input.userData, "anthropic", input.instanceId);
    if (!credentials) {
      throw new Error("Anthropic credentials are not configured");
    }
    const anthropic = createAnthropic({ apiKey: credentials.apiKey });
    return anthropic(modelId) as unknown as LanguageModel;
  }

  if (input.backend === "google") {
    const credentials = loadProviderCredentials(input.userData, "google", input.instanceId);
    if (!credentials) {
      throw new Error("Google AI credentials are not configured");
    }
    const google = createGoogleGenerativeAI({ apiKey: credentials.apiKey });
    return google(modelId) as unknown as LanguageModel;
  }

  if (input.backend === "openrouter") {
    const credentials = loadProviderCredentials(input.userData, "openrouter", input.instanceId);
    if (!credentials) {
      throw new Error("OpenRouter credentials are not configured");
    }
    const openrouter = createOpenAI({
      apiKey: credentials.apiKey,
      baseURL: OPENROUTER_API_BASE,
    });
    return openrouter.chat(modelId) as unknown as LanguageModel;
  }

  if (input.backend === "openai_compatible") {
    const credentials = loadProviderCredentials(
      input.userData,
      "openai_compatible",
      input.instanceId,
    );
    if (!credentials) {
      throw new Error("OpenAI-compatible credentials are not configured");
    }
    const baseURL = validatedCompatibleBaseUrl(input.baseUrl);
    const openai = createOpenAI({
      apiKey: credentials.apiKey,
      baseURL,
    });
    return openai(modelId);
  }

  throw new Error(`Unsupported inference backend: ${input.backend}`);
}
