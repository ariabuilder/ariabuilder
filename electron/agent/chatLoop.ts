import { createHmac, randomBytes } from "node:crypto";
import { stepCountIs, streamText } from "ai";
import type { ModelMessage } from "ai";
import {
  AGENT_MAX_STEPS,
  AgentChatInputSchema,
  type AgentStreamEvent,
  type AgentChatMessage,
} from "../../shared/agent";
import { resolveAgentAvailability } from "./availability";
import {
  assertModelAllowed,
  canUseChatInference,
  resolveRequestInference,
} from "./inferenceSelection";
import { resolveLanguageModel } from "./resolveModel";
import { buildAgentSystemPrompt } from "./systemPrompt";
import { buildDesktopAiTools } from "./tools";
import { repairCompactedAriaToolCall } from "./toolCallRepair";
import {
  describeAgentToolApproval,
  normalizeAgentToolArguments,
  type RendererToolExecutor,
} from "./toolRegistry";
import {
  consumePendingConfirmation,
  denyPendingConfirmation,
  registerPendingConfirmation,
} from "./confirmationStore";
import { resolveProjectAgentSettings } from "./projectSettings";

const approvalSigningKey = randomBytes(32);

function approvalSecret(
  userData: string,
  projectPath: string,
  webContentsId: number,
): string {
  return createHmac("sha256", approvalSigningKey)
    .update(
      `aria-app:tool-approval:v2\0${userData}\0${projectPath}\0${webContentsId}`,
    )
    .digest("hex");
}

function normalizedProviderError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "Provider error");
  const redacted = raw
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  if (/abort|timeout|timed out/i.test(redacted)) {
    return "The inference provider timed out. Retry the request.";
  }
  if (/401|403|unauthorized|forbidden|api.?key/i.test(redacted)) {
    return "The inference provider rejected the configured credentials.";
  }
  if (/429|rate.?limit/i.test(redacted)) {
    return "The inference provider rate limit was reached. Retry shortly.";
  }
  return `Inference provider error: ${redacted.slice(0, 500)}`;
}

function toModelMessages(messages: AgentChatMessage[]): ModelMessage[] {
  const toolCallIdToToolName = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const tc of m.toolCalls) {
        toolCallIdToToolName.set(tc.id, tc.toolName);
      }
    }
  }

  return messages.flatMap((message): ModelMessage[] => {
    if (message.role === "tool") {
      const content: Array<Record<string, unknown>> = (
        message.approvalResponses ?? []
      ).map((approval) => ({
        type: "tool-approval-response",
        approvalId: approval.approvalId,
        approved: approval.approved,
        ...(approval.reason ? { reason: approval.reason } : {}),
      }));
      const toolCallId = message.toolCallId ?? "";
      if (toolCallId) {
        const toolName = toolCallIdToToolName.get(toolCallId) ?? "unknown";
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.content);
        } catch {
          parsed = message.content;
        }
        const output =
          typeof parsed === "string"
            ? ({ type: "text" as const, value: parsed } as const)
            : ({ type: "json" as const, value: parsed } as const);
        content.push({
          type: "tool-result",
          toolCallId,
          toolName,
          output,
        });
      }
      return [
        {
          role: "tool",
          content,
        } as ModelMessage,
      ];
    }

    if (
      message.role === "assistant" &&
      (message.toolCalls?.length || message.approvalRequests?.length)
    ) {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "reasoning"; text: string }
        | {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: unknown;
          }
        | {
            type: "tool-approval-request";
            approvalId: string;
            toolCallId: string;
            signature?: string;
          }
      > = [];
      if (message.reasoning) {
        parts.push({ type: "reasoning", text: message.reasoning });
      }
      if (message.content) {
        parts.push({ type: "text", text: message.content });
      }
      for (const tc of message.toolCalls ?? []) {
        parts.push({
          type: "tool-call",
          toolCallId: tc.id,
          toolName: tc.toolName,
          input: tc.input,
        });
      }
      for (const approval of message.approvalRequests ?? []) {
        parts.push({
          type: "tool-approval-request",
          approvalId: approval.approvalId,
          toolCallId: approval.toolCallId,
          ...(approval.signature ? { signature: approval.signature } : {}),
        });
      }
      return [{ role: "assistant", content: parts } as ModelMessage];
    }

    if (message.role === "user" || message.role === "system") {
      return [
        {
          role: message.role,
          content: message.content,
        } as ModelMessage,
      ];
    }

    return [
      {
        role: "assistant",
        content: message.content,
      } as ModelMessage,
    ];
  });
}

function approvalToolCall(
  messages: readonly AgentChatMessage[],
  approvalId: string,
): { toolCallId: string; toolName: string; input: unknown } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const request = message.approvalRequests?.find(
      (candidate) => candidate.approvalId === approvalId,
    );
    if (!request) continue;
    const toolCall = message.toolCalls?.find(
      (candidate) => candidate.id === request.toolCallId,
    );
    return toolCall
      ? {
          toolCallId: toolCall.id,
          toolName: toolCall.toolName,
          input: toolCall.input,
        }
      : null;
  }
  return null;
}

export async function* runAgentChatStreaming(input: {
  userData: string;
  projectPath: string;
  webContentsId: number;
  body: unknown;
  abortSignal?: AbortSignal;
  rendererCapabilities?: {
    navigation: boolean;
    document: boolean;
  };
  executeRendererTool?: RendererToolExecutor;
}): AsyncGenerator<AgentStreamEvent, void, void> {
  const parsed = AgentChatInputSchema.safeParse(input.body);
  if (!parsed.success) {
    yield { type: "error", error: "Invalid chat input" };
    yield { type: "finished" };
    return;
  }

  const chatInput = parsed.data;
  const latestMessage = chatInput.messages.at(-1);
  if (latestMessage?.role === "tool" && latestMessage.approvalResponses?.length) {
    for (const response of latestMessage.approvalResponses) {
      const toolCall = approvalToolCall(chatInput.messages, response.approvalId);
      if (!response.approved) {
        denyPendingConfirmation({
          approvalId: response.approvalId,
          projectPath: input.projectPath,
          webContentsId: input.webContentsId,
        });
        continue;
      }
      const normalized = toolCall
        ? normalizeAgentToolArguments(toolCall.toolName, toolCall.input)
        : { ok: false as const };
      const consumed =
        toolCall && normalized.ok
          ? consumePendingConfirmation({
              approvalId: response.approvalId,
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              normalizedArgs: normalized.value,
              projectPath: input.projectPath,
              webContentsId: input.webContentsId,
            })
          : { ok: false as const, reason: "Confirmation no longer matches a pending tool call." };
      if (!consumed.ok) {
        yield { type: "error", error: consumed.reason };
        yield { type: "finished" };
        return;
      }
    }
  }
  const { settings: agentSettings, configuredBackends } =
    resolveProjectAgentSettings(input.userData, input.projectPath);
  const availability = resolveAgentAvailability({
    siteSettingsAgent: agentSettings,
    configuredBackends,
  });

  if (availability.effectiveInferenceBackend === "unavailable") {
    yield {
      type: "error",
      error:
        availability.reason === "disabled"
          ? "Add an inference provider in Settings ? Agent to enable Aria Engineer."
          : "Inference is not configured. Add a BYOK API key in Settings ? Agent.",
    };
    yield { type: "finished" };
    return;
  }

  const resolved = resolveRequestInference({
    settings: agentSettings,
    configuredBackends,
    sessionOverride: chatInput.sessionModel,
  });

  if (
    !resolved ||
    !canUseChatInference({ settings: agentSettings, configuredBackends })
  ) {
    yield { type: "error", error: "Selected inference is not configured" };
    yield { type: "finished" };
    return;
  }

  try {
    assertModelAllowed(agentSettings, resolved.provider, resolved.modelId);
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    yield { type: "finished" };
    return;
  }

  const system = buildAgentSystemPrompt({
    settings: agentSettings,
    composerMode: chatInput.composerMode,
    shellContext: chatInput.shellContext,
  });

  const providerSignal = input.abortSignal
    ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);

  const tools = buildDesktopAiTools({
    deps: {
      projectPath: input.projectPath,
      userData: input.userData,
      webContentsId: input.webContentsId,
      abortSignal: providerSignal,
      executeRendererTool: input.executeRendererTool,
      rendererCapabilities: input.rendererCapabilities,
      shellContext: chatInput.shellContext,
    },
    composerMode: chatInput.composerMode,
  });

  const messages = toModelMessages(chatInput.messages);
  const PROVIDER_MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      const delayMs = Math.min(1_000 * 3 ** (attempt - 2), 3_000);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          if (providerSignal.aborted) {
            onAbort();
            return;
          }
          providerSignal.addEventListener("abort", onAbort, { once: true });
        });
      } catch {
        break;
      }
      if (providerSignal.aborted) break;
    }

    let started = false;
    let retryableError: unknown = null;
    try {
      // Re-resolve the LanguageModel on each attempt (credential/baseUrl refresh).
      const model = await resolveLanguageModel({
        userData: input.userData,
        backend: resolved.provider,
        instanceId: resolved.instanceId,
        modelId: resolved.modelId,
        baseUrl:
          agentSettings.inference.providerInstances[resolved.instanceId]?.baseUrl,
      });

      const result = streamText({
      model,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(AGENT_MAX_STEPS),
      abortSignal: providerSignal,
      experimental_repairToolCall: repairCompactedAriaToolCall,
      experimental_toolApprovalSecret: approvalSecret(
        input.userData,
        input.projectPath,
        input.webContentsId,
      ),
    });

      for await (const part of result.fullStream) {
        if (providerSignal.aborted) break;

      if (part.type === "text-delta") {
        const delta =
          "textDelta" in part
            ? String((part as { textDelta?: string }).textDelta ?? "")
            : "delta" in part
              ? String((part as { delta?: string }).delta ?? "")
              : "text" in part
                ? String((part as { text?: string }).text ?? "")
                : "";
        if (delta) {
          started = true;
          yield { type: "text-delta", delta };
        }
        continue;
      }

      if (part.type === "reasoning-delta") {
        const delta =
          "text" in part
            ? String((part as { text?: string }).text ?? "")
            : "textDelta" in part
              ? String((part as { textDelta?: string }).textDelta ?? "")
              : "delta" in part
                ? String((part as { delta?: string }).delta ?? "")
                : "";
        if (delta) {
          started = true;
          yield { type: "reasoning", delta };
        }
        continue;
      }

      if (part.type === "tool-call") {
        // A tool may execute immediately after this part. Never retry beyond
        // this boundary, even if no user-visible text was streamed.
        started = true;
        yield {
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: "input" in part ? part.input : (part as { args?: unknown }).args,
        };
        continue;
      }

      if (part.type === "tool-result") {
        started = true;
        yield {
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result:
            "output" in part
              ? part.output
              : (part as { result?: unknown }).result,
        };
        continue;
      }

      if (part.type === "tool-approval-request") {
        started = true;
        const toolCall = part.toolCall;
        const presentation = describeAgentToolApproval(
          toolCall.toolName,
          toolCall.input,
        );
        const normalized = normalizeAgentToolArguments(
          toolCall.toolName,
          toolCall.input,
        );
        if (presentation && normalized.ok) {
          registerPendingConfirmation({
            approvalId: part.approvalId,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            normalizedArgs: normalized.value,
            projectPath: input.projectPath,
            webContentsId: input.webContentsId,
          });
          yield {
            type: "tool-approval-request",
            approvalId: part.approvalId,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            ...(part.signature ? { signature: part.signature } : {}),
            summary: presentation.summary,
            confirmationCategory: presentation.category,
          };
        }
        continue;
      }

      if (part.type === "error") {
        const err = (part as { error?: unknown }).error;
        if (!started && attempt < PROVIDER_MAX_ATTEMPTS && !providerSignal.aborted) {
          retryableError = err;
          break;
        }
        yield {
          type: "error",
          error: normalizedProviderError(err),
        };
        started = true;
        continue;
      }

      if (part.type === "finish") {
        const usage = (part as { usage?: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number } }).usage;
        yield {
          type: "finish",
          finishReason: ((part as { finishReason?: string }).finishReason ??
            "stop") as
            | "stop"
            | "length"
            | "content-filter"
            | "tool-calls"
            | "error"
            | "other",
          usage: usage
            ? {
                promptTokens: usage.promptTokens ?? usage.inputTokens ?? 0,
                completionTokens:
                  usage.completionTokens ?? usage.outputTokens ?? 0,
              }
            : undefined,
        };
      }
      }
      if (retryableError !== null) continue;
      break;
    } catch (error) {
      if (!started && attempt < PROVIDER_MAX_ATTEMPTS && !providerSignal.aborted) continue;
      if (input.abortSignal?.aborted) {
        yield { type: "finish", finishReason: "other" };
      } else {
        yield {
          type: "error",
          error: normalizedProviderError(error),
        };
      }
      break;
    }
  }

  yield { type: "finished" };
}
