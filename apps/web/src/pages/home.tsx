import { useEffect, useMemo, useState } from "react";
import { Circle, Maximize2 } from "lucide-react";
import type { TaskState } from "@frank/shared";
import {
  createTask,
  getChatStatus,
  getHermesStatus,
  listModels,
  listTasks,
  runTaskWithHermes,
  sendChatMessage,
  type ChatMessage,
  type Model,
  type Task
} from "../api.js";
import { ChatComposer, type ComposerMode, type ComposerModel, type ComposerSubmitInput } from "../components/chat/chat-composer.js";
import type { HomeSelection } from "../lib/home-context.js";
import { titleize } from "../lib/format.js";

export interface HomePageProps {
  selection: HomeSelection | null;
  onSelectionChange: (selection: HomeSelection | null) => void;
}

const activeTaskStates = new Set<TaskState>(["queued", "running", "blocked", "waiting_approval"]);
const fallbackModel: ComposerModel = { id: "default", label: "API Chat" };

export function HomePage({ selection, onSelectionChange }: HomePageProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [models, setModels] = useState<ComposerModel[]>([fallbackModel]);
  const [selectedModelId, setSelectedModelId] = useState(fallbackModel.id);
  const [selectedMode, setSelectedMode] = useState("chat");
  const [hermesAvailable, setHermesAvailable] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listTasks({ limit: 100 }, { signal: controller.signal })
      .then((loadedTasks) => setTasks(loadedTasks))
      .catch(() => setTasks([]));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listModels({ status: "available", limit: 100 }, { signal: controller.signal }),
      getChatStatus({ signal: controller.signal }).catch(() => null)
    ])
      .then(([availableModels, chatStatus]) => {
        const mappedModels = availableModels.map(modelToComposerModel);
        const openAiModel = chatStatus?.configured
          ? [{ id: "default", label: "API Chat", detail: chatStatus.model }]
          : [fallbackModel];
        const nextModels = [...openAiModel, ...mappedModels.filter((model) => model.id !== "default")];
        setModels(nextModels);
        setSelectedModelId((current) => nextModels.some((model) => model.id === current) ? current : nextModels[0]!.id);
      })
      .catch(() => {
        setModels([fallbackModel]);
        setSelectedModelId(fallbackModel.id);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getHermesStatus({ signal: controller.signal })
      .then((response) => setHermesAvailable(response.status.enabled && response.status.configured && response.status.health === "ok"))
      .catch(() => setHermesAvailable(false));
    return () => controller.abort();
  }, []);

  const modes = useMemo<ComposerMode[]>(() => {
    const baseModes = [
      { id: "chat", label: "Chat" },
      { id: "task", label: "Task" },
      { id: "research", label: "Research" },
      { id: "code", label: "Code" },
      { id: "summarize", label: "Summarize" }
    ];
    return hermesAvailable
      ? [...baseModes.slice(0, 2), { id: "hermes", label: "Run with Hermes" }, ...baseModes.slice(2)]
      : baseModes;
  }, [hermesAvailable]);

  useEffect(() => {
    if (!modes.some((mode) => mode.id === selectedMode)) {
      setSelectedMode("chat");
    }
  }, [modes, selectedMode]);

  const activeRuns = tasks.filter((task) => activeTaskStates.has(task.state));

  async function handleSubmit(input: ComposerSubmitInput) {
    const metadata = {
      source: "home_composer",
      mode: input.selectedMode,
      selectedModelId: input.selectedModelId,
      attachments: input.attachments.map((attachment) => ({
        name: attachment.name,
        type: attachment.type,
        size: attachment.size ?? null
      }))
    };

    if (input.selectedMode !== "task" && input.selectedMode !== "hermes") {
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: input.text,
        createdAt: new Date().toISOString()
      };
      setMessages((current) => [...current, userMessage]);
      const mode = chatMode(input.selectedMode);
      const response = await sendChatMessage({
        message: input.text,
        mode,
        modelId: input.selectedModelId,
        ...(previousResponseId ? { previousResponseId } : {}),
        metadata
      });
      setPreviousResponseId(response.responseId);
      setMessages((current) => [...current, response.assistantMessage]);
      onSelectionChange({
        kind: "chat",
        id: response.responseId ?? response.assistantMessage.id,
        title: "Frank replied",
        subtitle: `${response.model} - ${response.usage.inputTokens + response.usage.outputTokens} tokens`
      });
      return;
    }

    const task = await createTask({
      title: titleFromRequest(input.text),
      description: input.text,
      executionKind: input.selectedMode === "hermes" ? "hermes_operator" : "manual_lifecycle",
      metadata
    });

    setTasks((current) => [task, ...current.filter((row) => row.id !== task.id)]);
    onSelectionChange({
      kind: "sent-task",
      id: task.id,
      title: task.title,
      subtitle: input.selectedMode === "hermes" ? "Task created; starting Hermes" : "Task draft created"
    });

    if (input.selectedMode === "hermes") {
      try {
        const result = await runTaskWithHermes(task.id, { metadata });
        setTasks((current) => [result.task, ...current.filter((row) => row.id !== result.task.id)]);
        onSelectionChange({
          kind: "sent-task",
          id: result.task.id,
          title: result.task.title,
          subtitle: result.reused ? "Existing Hermes run is active" : "Hermes run queued"
        });
      } catch (error) {
        throw new Error(`Task created, but Hermes could not start: ${errorMessage(error)}`);
      }
    }
  }

  return (
    <section className="relative flex min-h-[calc(100dvh-var(--frank-topbar-height)-5rem)] flex-col overflow-hidden rounded-xl bg-background lg:min-h-[calc(100vh-var(--frank-topbar-height)-2.5rem)]">
      <button
        type="button"
        className="absolute right-0 top-0 hidden size-11 items-center justify-center rounded-xl border border-border bg-surface text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring md:flex"
        aria-label="Expand workspace"
        title="Expand workspace"
      >
        <Maximize2 className="size-4" aria-hidden="true" />
      </button>

      <div className="flex min-h-0 flex-1 items-center justify-center px-1 pb-6 pt-6 sm:px-3 sm:pb-8 sm:pt-8">
        {messages.length > 0 ? (
          <div className="grid w-full max-w-4xl gap-4 self-stretch overflow-y-auto px-1 text-left">
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-primary-foreground"
                    : "mr-auto max-w-[85%] rounded-2xl border border-border bg-surface px-4 py-3 text-foreground shadow-sm"
                }
              >
                <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
              </article>
            ))}
          </div>
        ) : (
        <div className="grid max-w-2xl justify-items-center gap-4 text-center">
          <div className="grid gap-2">
            <h2 className="text-2xl font-semibold leading-tight text-foreground sm:text-4xl">How can I help you today?</h2>
            <p className="w-fit max-w-full justify-self-center rounded-full border border-border bg-surface px-3 py-2 text-sm text-muted-foreground sm:px-4">
              Ask anything or type <kbd className="rounded bg-surface-muted px-1.5 py-0.5 text-foreground">/</kbd> for commands
            </p>
          </div>

          {selection ? (
            <div className="mt-6 grid max-w-md gap-1 rounded-xl border border-border bg-surface/80 px-4 py-3 text-left shadow-[var(--frank-shadow-panel)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titleize(selection.kind)}</p>
              <p className="text-sm font-semibold text-foreground">{selection.title}</p>
              {selection.subtitle ? <p className="text-sm text-muted-foreground">{selection.subtitle}</p> : null}
            </div>
          ) : null}
        </div>
        )}
      </div>

      {activeRuns.length > 0 ? (
        <div className="mx-auto mb-3 flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground">
          <Circle className="size-2.5 fill-warning text-warning" aria-hidden="true" />
          {activeRuns.length} active {activeRuns.length === 1 ? "run" : "runs"}
        </div>
      ) : null}

      <div className="sticky bottom-0 mx-auto w-full max-w-6xl bg-gradient-to-t from-background via-background/95 to-background/0 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-6 sm:pt-8">
        <ChatComposer
          models={models}
          modes={modes}
          selectedModelId={selectedModelId}
          selectedMode={selectedMode}
          onModelChange={setSelectedModelId}
          onModeChange={setSelectedMode}
          onSubmit={handleSubmit}
        />
      </div>
    </section>
  );
}

function modelToComposerModel(model: Model): ComposerModel {
  return {
    id: model.id,
    label: model.displayName || model.modelKey,
    detail: model.providerId
  };
}

function titleFromRequest(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 8).join(" ");
  return words.length > 80 ? `${words.slice(0, 77)}...` : words;
}

function chatMode(mode: string): "chat" | "research" | "code" | "summarize" {
  if (mode === "research" || mode === "code" || mode === "summarize") {
    return mode;
  }
  return "chat";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to complete the request.";
}
