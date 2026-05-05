import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";

const chatMessageSchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
    mode: z.enum(["chat", "research", "code", "summarize"]).default("chat"),
    modelId: z.string().trim().min(1).max(200).optional(),
    previousResponseId: z.string().trim().min(1).max(200).optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

interface OpenAIResponseBody {
  id?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export function registerChatRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
  server.get("/v1/chat/status", async () => chatStatus(config));

  server.post("/v1/chat/messages", async (request, reply) => {
    const body = chatMessageSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const status = chatStatus(config);
    if (!status.configured) {
      return reply.code(409).send({
        error: "chat_not_configured",
        message: "OpenAI chat requires OPENAI_API_KEY and OPENAI_CHAT_MODEL in the VPS access env.",
        status
      });
    }

    const actorId = getRequestActorId(request);
    const startedAt = Date.now();
    const model = config.openai.chatModel;
    const requestBody = {
      model,
      input: body.data.message,
      instructions: instructionsForMode(body.data.mode),
      ...(body.data.previousResponseId ? { previous_response_id: body.data.previousResponseId } : {})
    };

    try {
      const response = await fetch(`${config.openai.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.openai.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });
      const raw = await response.text();
      const parsed = parseOpenAIResponse(raw);

      if (!response.ok) {
        throw new Error(parsed.error?.message ?? `OpenAI Responses API returned HTTP ${response.status}.`);
      }

      const content = extractOutputText(parsed);
      const responseId = parsed.id ?? null;
      const inputTokens = integerOrZero(parsed.usage?.input_tokens);
      const outputTokens = integerOrZero(parsed.usage?.output_tokens);
      await recordUsage(pool, {
        model,
        responseId,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - startedAt,
        mode: body.data.mode
      });
      await recordAuditEvent(pool, {
        actorType: "user",
        actorId,
        action: "chat.openai.message",
        targetType: "provider",
        targetId: "openai",
        outcome: "success",
        metadata: {
          mode: body.data.mode,
          model,
          responseId
        }
      });

      return {
        provider: "openai",
        model,
        responseId,
        assistantMessage: {
          id: responseId ?? `local-${Date.now()}`,
          role: "assistant" as const,
          content,
          createdAt: new Date().toISOString()
        },
        usage: {
          inputTokens,
          outputTokens
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenAI chat request failed.";
      await recordAuditEvent(pool, {
        actorType: "user",
        actorId,
        action: "chat.openai.message",
        targetType: "provider",
        targetId: "openai",
        outcome: "failure",
        metadata: {
          mode: body.data.mode,
          model,
          message
        }
      }).catch(() => undefined);

      return reply.code(502).send({
        error: "chat_request_failed",
        message
      });
    }
  });
}

function chatStatus(config: ApiConfig) {
  const apiKeyConfigured = Boolean(config.openai.apiKey);
  const modelConfigured = Boolean(config.openai.chatModel);
  return {
    provider: "openai" as const,
    configured: apiKeyConfigured && modelConfigured,
    apiKeyConfigured,
    modelConfigured,
    model: config.openai.chatModel,
    baseUrl: config.openai.baseUrl,
    notes: [
      "Home chat sends directly to OpenAI through Frank API.",
      "ChatGPT subscriptions and OpenAI API billing are separate; Frank needs an OpenAI API key."
    ]
  };
}

function instructionsForMode(mode: z.infer<typeof chatMessageSchema>["mode"]): string {
  const base = "You are Frank, the user's private AI interface for frank.fail. Be direct, practical, and concise.";
  if (mode === "code") {
    return `${base} Focus on software engineering help. Do not claim to edit files unless the request is explicitly handed to Hermes or Codex.`;
  }
  if (mode === "research") {
    return `${base} Give a useful research answer and say when live source checking is needed.`;
  }
  if (mode === "summarize") {
    return `${base} Summarize clearly, preserving decisions, risks, and next actions.`;
  }
  return base;
}

function parseOpenAIResponse(raw: string): OpenAIResponseBody {
  try {
    return JSON.parse(raw) as OpenAIResponseBody;
  } catch {
    return {
      output_text: raw
    };
  }
}

function extractOutputText(response: OpenAIResponseBody): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }
  const text = response.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .trim();
  return text || "OpenAI returned an empty response.";
}

async function recordUsage(
  pool: PgPool,
  input: {
    model: string;
    responseId: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    mode: string;
  }
): Promise<void> {
  await pool.query(
    `
      insert into model_usage (
        role_id,
        provider_id,
        request_id,
        input_tokens,
        output_tokens,
        metadata
      )
      values ('router_fast', 'openai', $1, $2, $3, $4::jsonb)
    `,
    [
      input.responseId,
      input.inputTokens,
      input.outputTokens,
      JSON.stringify({
        model: input.model,
        mode: input.mode,
        latencyMs: input.latencyMs,
        source: "home_chat"
      })
    ]
  );
}

function integerOrZero(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "invalid_request",
    message: "Request validation failed.",
    details: error.flatten()
  });
}

function getRequestActorId(request: FastifyRequest): string {
  return request.accessIdentity?.email ?? request.accessIdentity?.sub ?? "unknown";
}
