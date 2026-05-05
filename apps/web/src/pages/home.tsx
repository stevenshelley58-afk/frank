import { useEffect, useState } from "react";
import { Globe2, RefreshCw, TriangleAlert } from "lucide-react";
import { startBrowser, type BrowserStatusResponse } from "../api.js";
import { Button } from "../components/ui/index.js";

type BrowserLoadState =
  | { status: "starting" }
  | { status: "ready"; browser: BrowserStatusResponse }
  | { status: "error"; title: string; message: string; showAiTools: boolean };

export interface HomePageProps {
  onOpenAiConsole?: (() => void) | undefined;
}

export function HomePage({ onOpenAiConsole }: HomePageProps = {}) {
  const [state, setState] = useState<BrowserLoadState>({ status: "starting" });

  async function openChatGptBrowser() {
    setState({ status: "starting" });
    try {
      const browser = await startBrowser("chatgpt");
      setState(browserState(browser));
    } catch (error) {
      setState({
        status: "error",
        title: "ChatGPT did not start",
        message: errorMessage(error),
        showAiTools: true
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    setState({ status: "starting" });
    startBrowser("chatgpt")
      .then((browser) => {
        if (!cancelled) {
          setState(browserState(browser));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            title: "ChatGPT did not start",
            message: errorMessage(error),
            showAiTools: true
          });
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
            <p className="truncate text-sm text-muted-foreground">{statusLabel(state)}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void openChatGptBrowser()}>
          <RefreshCw aria-hidden="true" />
          Open ChatGPT
        </Button>
      </div>

      {state.status === "starting" ? (
        <div className="grid min-h-[28rem] place-items-center rounded-lg border border-border bg-surface sm:min-h-[38rem]" aria-live="polite">
          <div className="grid max-w-sm justify-items-center gap-3 px-6 text-center">
            <RefreshCw className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">Opening ChatGPT</p>
            <p className="text-sm leading-6 text-muted-foreground">This can take a few seconds after a deploy or browser restart.</p>
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="grid min-h-[28rem] place-items-center rounded-lg border border-border bg-surface p-4 sm:min-h-[38rem]" role="alert">
          <div className="grid max-w-lg justify-items-center gap-4 text-center">
            <span className="flex size-11 items-center justify-center rounded-md border border-border bg-background text-destructive">
              <TriangleAlert className="size-5" aria-hidden="true" />
            </span>
            <div className="grid gap-2">
              <h3 className="text-base font-semibold text-foreground">{state.title}</h3>
              <p className="text-sm leading-6 text-muted-foreground">{state.message}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => void openChatGptBrowser()}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
              {state.showAiTools && onOpenAiConsole ? (
                <Button type="button" variant="outline" onClick={onOpenAiConsole}>
                  Open AI tools
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <iframe
          title="ChatGPT browser"
          src={state.browser.url}
          allow="clipboard-read; clipboard-write; fullscreen"
          referrerPolicy="no-referrer"
          className="h-full min-h-[28rem] w-full rounded-lg border border-border bg-black sm:min-h-[38rem]"
        />
      ) : null}
    </section>
  );
}

function browserState(browser: BrowserStatusResponse): BrowserLoadState {
  if (browser.configured === false) {
    return {
      status: "error",
      title: "ChatGPT is not connected",
      message: "Frank's browser setup is missing. Open AI tools to check the connection, then try again.",
      showAiTools: true
    };
  }

  if (browser.running !== true) {
    return {
      status: "error",
      title: "ChatGPT did not start",
      message: browser.message?.trim() || "Frank tried to open ChatGPT, but the browser did not report ready.",
      showAiTools: true
    };
  }

  if (!browser.url.trim()) {
    return {
      status: "error",
      title: "ChatGPT did not start",
      message: "Frank opened the browser service, but did not receive a browser address.",
      showAiTools: true
    };
  }

  return { status: "ready", browser };
}

function statusLabel(state: BrowserLoadState): string {
  if (state.status === "ready") {
    return "Ready";
  }
  if (state.status === "error") {
    return "Needs attention";
  }
  return "Opening in Frank";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to start the ChatGPT browser.";
}
