import { ExternalLink, FolderOpen, Play, Power, RefreshCw, ScrollText, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createAionUiSession,
  getAionUiLogs,
  getAionUiStatus,
  startAionUi,
  stopAionUi,
  type AionUiStatusResponse
} from "../api.js";
import {
  EmptyState,
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge
} from "../components/dashboard/index.js";
import { Alert, AlertDescription, AlertTitle, Button } from "../components/ui/index.js";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: AionUiStatusResponse }
  | { status: "error"; message: string };

export function AionUiPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const sessionRequestedRef = useRef(false);

  const load = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getAionUiStatus({ signal: controller.signal })
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

  useEffect(() => {
    if (state.status !== "ready" || !state.data.running || frameUrl || sessionRequestedRef.current) {
      return;
    }
    sessionRequestedRef.current = true;
    void openAionUi();
  }, [frameUrl, state]);

  async function startRuntime() {
    setBusy("start");
    setMessage(null);
    try {
      const result = await startAionUi();
      setMessage(result.message);
      load();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function stopRuntime() {
    setBusy("stop");
    setMessage(null);
    try {
      const result = await stopAionUi();
      setMessage(result.message);
      setFrameUrl(null);
      sessionRequestedRef.current = false;
      load();
    } catch (error) {
      sessionRequestedRef.current = false;
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function openAionUi() {
    setBusy("session");
    setMessage(null);
    try {
      const session = await createAionUiSession();
      setFrameUrl(session.publicUrl);
      setMessage("AionUi session is ready.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshLogs() {
    setBusy("logs");
    setMessage(null);
    try {
      const result = await getAionUiLogs();
      setLogs(result.output ?? result.message);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return <LoadingBlock rows={8} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => load()} />;
  }

  const status = state.data;

  return (
    <section className="grid gap-5">
      <SectionCard
        title="AionUi"
        description="Production WebUI runtime embedded behind Frank access."
        icon={<SquareTerminal aria-hidden="true" />}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <StatusBadge tone={status.running ? "healthy" : "neutral"}>{status.running ? "Running" : "Stopped"}</StatusBadge>
            <Button type="button" variant="outline" size="sm" onClick={() => load()}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
          <KeyValueList
            items={[
              { label: "Configured", value: status.configured ? "Yes" : "No" },
              { label: "Version", value: status.version },
              { label: "Public URL", value: status.publicUrl },
              { label: "Internal URL", value: status.internalBaseUrl },
              { label: "Message", value: status.message ?? "No issues reported" }
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void startRuntime()} disabled={busy !== null}>
              <Play aria-hidden="true" />
              Start
            </Button>
            <Button type="button" variant="outline" onClick={() => void openAionUi()} disabled={busy !== null || !status.running}>
              <ExternalLink aria-hidden="true" />
              Open Embedded
            </Button>
            <Button type="button" variant="outline" onClick={() => void refreshLogs()} disabled={busy !== null}>
              <ScrollText aria-hidden="true" />
              Logs
            </Button>
            <Button type="button" variant="outline" onClick={() => void stopRuntime()} disabled={busy !== null || !status.running}>
              <Power aria-hidden="true" />
              Stop
            </Button>
          </div>
          {message ? (
            <Alert>
              <AlertTitle>AionUi</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Workspace Mounts" description="Shared VPS paths visible to AionUi and Hermes." icon={<FolderOpen aria-hidden="true" />}>
        <div className="grid gap-2">
          {status.workspaceMounts.map((mount) => (
            <div key={mount} className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground">
              {mount}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Embedded Runtime" icon={<SquareTerminal aria-hidden="true" />} contentClassName="p-0">
        {frameUrl ? (
          <iframe
            title="AionUi WebUI"
            src={frameUrl}
            allow="clipboard-read; clipboard-write; fullscreen; virtual-keyboard"
            referrerPolicy="same-origin"
            className="h-[calc(100dvh-15rem)] min-h-[42rem] w-full rounded-b-lg border-0 bg-black"
          />
        ) : (
          <div className="p-4">
            <EmptyState icon={<SquareTerminal aria-hidden="true" />} title="AionUi is not attached" description="Start the runtime and open the embedded session." />
          </div>
        )}
      </SectionCard>

      {logs ? (
        <SectionCard title="Runtime Logs" icon={<ScrollText aria-hidden="true" />}>
          <pre className="max-h-[28rem] overflow-auto rounded-md border border-border bg-black p-4 font-mono text-xs leading-5 text-white">
            {logs}
          </pre>
        </SectionCard>
      ) : null}
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load AionUi.";
}
