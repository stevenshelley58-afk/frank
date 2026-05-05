import { useEffect, useState } from "react";
import { Globe2, RefreshCw } from "lucide-react";
import { startBrowser, type BrowserStatusResponse } from "../api.js";
import { ResourceError } from "../components/dashboard/index.js";
import { Button } from "../components/ui/index.js";

type BrowserLoadState =
  | { status: "starting" }
  | { status: "ready"; browser: BrowserStatusResponse }
  | { status: "error"; message: string };

export function HomePage() {
  const [state, setState] = useState<BrowserLoadState>({ status: "starting" });

  async function openChatGptBrowser() {
    setState({ status: "starting" });
    try {
      const browser = await startBrowser("chatgpt");
      setState({ status: "ready", browser });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }

  useEffect(() => {
    let cancelled = false;
    setState({ status: "starting" });
    startBrowser("chatgpt")
      .then((browser) => {
        if (!cancelled) {
          setState({ status: "ready", browser });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="grid min-h-[calc(100dvh-var(--frank-topbar-height)-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground">
            <Globe2 className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">ChatGPT</h2>
            <p className="truncate text-sm text-muted-foreground">VPS browser session</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void openChatGptBrowser()}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {state.status === "starting" ? (
        <div className="grid min-h-[38rem] place-items-center rounded-lg border border-border bg-surface">
          <div className="grid justify-items-center gap-3 text-center">
            <RefreshCw className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">Starting ChatGPT browser</p>
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <ResourceError message={state.message} onRetry={() => void openChatGptBrowser()} />
        </div>
      ) : null}

      {state.status === "ready" ? (
        <iframe
          title="ChatGPT browser"
          src={state.browser.url}
          className="h-full min-h-[38rem] w-full rounded-lg border border-border bg-black"
        />
      ) : null}
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to start the ChatGPT browser.";
}
