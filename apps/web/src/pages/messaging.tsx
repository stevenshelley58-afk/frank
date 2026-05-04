import { MessageCircle, RefreshCw, Send, ShieldCheck } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import {
  getWhatsAppStatus,
  sendWhatsAppNotification,
  type MessagingWhatsAppStatusResponse
} from "../api.js";
import {
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge
} from "../components/dashboard/index.js";
import { Button, Textarea } from "../components/ui/index.js";
import { titleize } from "../lib/format.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: MessagingWhatsAppStatusResponse }
  | { status: "error"; message: string };

export function MessagingPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [message, setMessage] = useState("Frank Hub WhatsApp smoke test.");
  const [sendResult, setSendResult] = useState<string | null>(null);

  const load = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getWhatsAppStatus({ signal: controller.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, []);

  async function sendTest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendResult(null);
    const result = await sendWhatsAppNotification({
      message,
      metadata: {
        source: "messaging_page"
      }
    });
    setSendResult(result.message);
    load();
  }

  if (state.status === "loading") {
    return <LoadingBlock rows={6} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => load()} />;
  }

  const { whatsapp, hermes, notes } = state.data;

  return (
    <section className="grid gap-5">
      <SectionCard
        title="WhatsApp"
        description="Hermes-native WhatsApp runs privately in the VPS lab."
        icon={<MessageCircle aria-hidden="true" />}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      >
        <KeyValueList
          items={[
            { label: "Provider", value: "Hermes native" },
            { label: "Configured", value: <StatusBadge tone={whatsapp.configured ? "healthy" : "degraded"}>{whatsapp.configured ? "Ready" : "Review"}</StatusBadge> },
            { label: "Runtime enabled", value: whatsapp.enabled ? "Enabled" : "Disabled" },
            { label: "Mode", value: titleize(whatsapp.mode) },
            { label: "Number", value: whatsapp.numberConfigured ? "Configured" : "Missing" },
            { label: "Allowed users", value: whatsapp.allowedUsersConfigured ? "Configured" : "Missing" },
            { label: "Webhook", value: whatsapp.webhookConfigured ? whatsapp.webhookRoute : "Missing" },
            { label: "Hermes API", value: hermes.enabled && hermes.privateApiConfigured ? "Configured" : "Review", description: hermes.apiBaseUrl }
          ]}
        />
      </SectionCard>

      <SectionCard title="Send Test" description="Send a Frank-to-WhatsApp notification through Hermes webhook delivery." icon={<Send aria-hidden="true" />}>
        <form className="grid gap-3" onSubmit={sendTest}>
          <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!whatsapp.configured}>
              <Send aria-hidden="true" />
              Send
            </Button>
            {sendResult ? <span className="text-sm text-muted-foreground">{sendResult}</span> : null}
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Pairing Procedure" description="Operational reminders for the VPS WhatsApp session." icon={<ShieldCheck aria-hidden="true" />}>
        <KeyValueList
          items={[
            { label: "Setup", value: "Run hermes whatsapp once against runtime/hermes and scan Frank's dedicated number." },
            { label: "Session path", value: "/opt/frank-hub/runtime/hermes/platforms/whatsapp/session" },
            { label: "Permissions", value: "Keep session files private and backed up with the VPS." },
            { label: "Notes", value: notes.join(" ") }
          ]}
        />
      </SectionCard>
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load messaging status.";
}
