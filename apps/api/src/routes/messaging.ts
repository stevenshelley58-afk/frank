import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";

const notifySchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

export function registerMessagingRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
  server.get("/v1/messaging/whatsapp/status", async () => whatsappStatus(config));

  server.post("/v1/messaging/whatsapp/notify", async (request, reply) => {
    const body = notifySchema.safeParse(request.body);
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const status = whatsappStatus(config);
    if (!status.whatsapp.configured || !config.messaging.whatsapp.webhookSecret) {
      return reply.code(409).send({
        error: "whatsapp_not_configured",
        message: "Hermes WhatsApp webhook delivery is not fully configured.",
        status
      });
    }

    const actorId = getRequestActorId(request);
    const payload = {
      message: body.data.message,
      metadata: body.data.metadata ?? {},
      deliver_only: true,
      target: "whatsapp",
      source: "frank_hub"
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha256", config.messaging.whatsapp.webhookSecret).update(rawBody).digest("hex");
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Webhook-Signature": signature
    });

    const url = `${config.messaging.whatsapp.webhookBaseUrl}/webhooks/${encodeURIComponent(config.messaging.whatsapp.webhookRoute)}`;
    let deliveryStatus = 202;
    let deliveryMessage = "WhatsApp notification accepted by Frank.";
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: rawBody
      });
      deliveryStatus = response.ok ? 202 : 502;
      deliveryMessage = response.ok ? "WhatsApp notification handed to Hermes webhook." : `Hermes webhook returned HTTP ${response.status}.`;
    } catch (error) {
      deliveryStatus = 502;
      deliveryMessage = error instanceof Error ? `Hermes webhook unavailable: ${error.message}` : "Hermes webhook unavailable.";
    }

    await recordAuditEvent(pool, {
      actorType: "user",
      actorId,
      action: "messaging.whatsapp.notify",
      targetType: "messaging",
      targetId: "whatsapp",
      outcome: deliveryStatus === 202 ? "success" : "failure",
      metadata: {
        route: config.messaging.whatsapp.webhookRoute,
        messageLength: body.data.message.length,
        metadataKeys: Object.keys(body.data.metadata ?? {})
      }
    });

    return reply.code(deliveryStatus).send({
      accepted: deliveryStatus === 202,
      message: deliveryMessage,
      whatsapp: status.whatsapp
    });
  });
}

function whatsappStatus(config: ApiConfig) {
  const webhookConfigured = Boolean(
    config.messaging.whatsapp.webhookBaseUrl &&
      config.messaging.whatsapp.webhookRoute &&
      config.messaging.whatsapp.webhookSecret
  );
  const numberConfigured = Boolean(config.accessProfile.whatsappNumber);
  const allowedUsersConfigured = config.messaging.whatsapp.allowedUsers.length > 0;
  const configured =
    config.messaging.whatsapp.enabled &&
    numberConfigured &&
    allowedUsersConfigured &&
    webhookConfigured &&
    config.hermes.enabled &&
    Boolean(config.hermes.apiServerKey);

  return {
    whatsapp: {
      provider: "hermes_native" as const,
      configured,
      enabled: config.messaging.whatsapp.enabled,
      mode: config.messaging.whatsapp.mode,
      numberConfigured,
      allowedUsersConfigured,
      webhookConfigured,
      webhookRoute: config.messaging.whatsapp.webhookRoute
    },
    hermes: {
      enabled: config.hermes.enabled,
      privateApiConfigured: Boolean(config.hermes.apiServerKey),
      apiBaseUrl: config.hermes.apiBaseUrl
    },
    notes: [
      "Hermes WhatsApp stays private inside the Compose network.",
      "Webhook secrets and WhatsApp session credentials are not returned by Frank."
    ]
  };
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
