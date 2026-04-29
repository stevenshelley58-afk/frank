import { Bot, Clock, Download, FileText, ListTodo, Plus, RefreshCw, ScrollText, Send, Square, Workflow } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { TASK_STATE_TRANSITIONS, isReopenableTaskState, type TaskState } from "@frank/shared";
import {
  DataTable,
  EmptyState,
  KeyValueList,
  LoadingBlock,
  ResourceError,
  SectionCard,
  StatusBadge,
  type StatusTone
} from "../components/dashboard/index.js";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/index.js";
import {
  createTask,
  getArtifactDownloadUrl,
  getHermesRunnerSession,
  listTaskArtifacts,
  listTaskEvents,
  listTaskLogs,
  listTasks,
  runTaskWithHermes,
  stopTaskHermes,
  updateTask,
  type RunnerArtifact,
  type RunnerLogEntry,
  type RunnerSession,
  type Task,
  type TaskEvent
} from "../api.js";
import { formatBytes, formatDateTime, metadataPreview, summarizeValue, titleize } from "../lib/format.js";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

interface RunnerLogView {
  logs: RunnerLogEntry[];
  lastSequence: number;
  nextCursor: number;
}

const emptyRunnerLogs: RunnerLogView = {
  logs: [],
  lastSequence: 0,
  nextCursor: 0
};

const activeRunnerStatuses = new Set(["queued", "starting", "running", "stopping"]);

export function TasksPage() {
  const [tasksState, setTasksState] = useState<LoadState<Task[]>>({ status: "loading" });
  const [eventsState, setEventsState] = useState<LoadState<TaskEvent[]>>({ status: "ready", data: [] });
  const [runnerLogsState, setRunnerLogsState] = useState<LoadState<RunnerLogView>>({
    status: "ready",
    data: emptyRunnerLogs
  });
  const [artifactsState, setArtifactsState] = useState<LoadState<RunnerArtifact[]>>({ status: "ready", data: [] });
  const [runnerSessionState, setRunnerSessionState] = useState<LoadState<RunnerSession | null>>({
    status: "ready",
    data: null
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("100");
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [stateMessage, setStateMessage] = useState<string | null>(null);
  const [runnerMessage, setRunnerMessage] = useState<string | null>(null);
  const [nextState, setNextState] = useState<TaskState | "">("");
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [runnerBusy, setRunnerBusy] = useState(false);

  const loadTasks = () => {
    const controller = new AbortController();
    setTasksState({ status: "loading" });
    listTasks({ limit: 100 }, { signal: controller.signal })
      .then((tasks) => {
        setTasksState({ status: "ready", data: tasks });
        setSelectedTaskId((current) => current ?? tasks[0]?.id ?? null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setTasksState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = loadTasks();
    return () => controller.abort();
  }, []);

  const tasks = tasksState.status === "ready" ? tasksState.data : [];
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null,
    [selectedTaskId, tasks]
  );
  const selectedRunnerSessionId = selectedTask ? metadataString(selectedTask.metadata, "activeRunnerSessionId") : null;

  useEffect(() => {
    if (!selectedTask) {
      setEventsState({ status: "ready", data: [] });
      setNextState("");
      return;
    }

    const controller = new AbortController();
    setEventsState({ status: "loading" });
    setNextState("");
    listTaskEvents(selectedTask.id, { signal: controller.signal })
      .then((events) => setEventsState({ status: "ready", data: events }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setEventsState({ status: "error", message: errorMessage(error) });
        }
      });
    return () => controller.abort();
  }, [selectedTask?.id]);

  useEffect(() => {
    if (!selectedTask) {
      setRunnerLogsState({ status: "ready", data: emptyRunnerLogs });
      setArtifactsState({ status: "ready", data: [] });
      setRunnerSessionState({ status: "ready", data: null });
      return;
    }

    const controller = new AbortController();
    let cursor = 0;
    let stopped = false;
    setRunnerLogsState({ status: "loading" });
    setArtifactsState({ status: "loading" });
    setRunnerSessionState(selectedRunnerSessionId ? { status: "loading" } : { status: "ready", data: null });

    const loadRunnerSurface = async (initial: boolean) => {
      try {
        const [logs, artifacts, session] = await Promise.all([
          listTaskLogs(selectedTask.id, { afterSequence: cursor, limit: 100 }, { signal: controller.signal }),
          listTaskArtifacts(selectedTask.id, { signal: controller.signal }),
          selectedRunnerSessionId
            ? getHermesRunnerSession(selectedRunnerSessionId, { signal: controller.signal }).catch(() => null)
            : Promise.resolve(null)
        ]);
        if (stopped) {
          return;
        }
        cursor = logs.next_cursor;
        setRunnerLogsState((current) => {
          const previous = current.status === "ready" && !initial ? current.data.logs : [];
          return {
            status: "ready",
            data: {
              logs: [...previous, ...logs.logs].slice(-200),
              lastSequence: logs.last_sequence,
              nextCursor: logs.next_cursor
            }
          };
        });
        setArtifactsState({ status: "ready", data: artifacts.artifacts });
        setRunnerSessionState({ status: "ready", data: session });
      } catch (error) {
        if (!controller.signal.aborted && !stopped) {
          const message = errorMessage(error);
          setRunnerLogsState({ status: "error", message });
          setArtifactsState({ status: "error", message });
          setRunnerSessionState({ status: "error", message });
        }
      }
    };

    void loadRunnerSurface(true);
    const shouldPoll =
      selectedTask.executionKind === "hermes_operator" ||
      selectedTask.state === "queued" ||
      selectedTask.state === "running";
    const intervalId = shouldPoll ? window.setInterval(() => void loadRunnerSurface(false), 3000) : null;

    return () => {
      stopped = true;
      controller.abort();
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [selectedTask?.id, selectedTask?.executionKind, selectedTask?.state, selectedRunnerSessionId]);

  const transitionOptions = selectedTask ? TASK_STATE_TRANSITIONS[selectedTask.state] : [];
  const runnerSession = runnerSessionState.status === "ready" ? runnerSessionState.data : null;
  const runnerActive = runnerSession
    ? activeRunnerStatuses.has(runnerSession.status)
    : selectedTask?.executionKind === "hermes_operator" && (selectedTask.state === "queued" || selectedTask.state === "running");

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateMessage(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setCreateMessage("A task title is required.");
      return;
    }

    const parsedPriority = Number(priority);
    if (!Number.isInteger(parsedPriority) || parsedPriority < 0 || parsedPriority > 1000) {
      setCreateMessage("Priority must be a whole number from 0 to 1000.");
      return;
    }

    setCreating(true);
    try {
      const task = await createTask({
        title: trimmedTitle,
        description: description.trim() || null,
        priority: parsedPriority
      });
      setTitle("");
      setDescription("");
      setPriority("100");
      setSelectedTaskId(task.id);
      setTasksState((current) =>
        current.status === "ready" ? { status: "ready", data: [task, ...current.data] } : { status: "ready", data: [task] }
      );
    } catch (error) {
      setCreateMessage(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function handleStateChange() {
    if (!selectedTask || !nextState) {
      return;
    }

    setStateMessage(null);
    setUpdating(true);
    try {
      const reopened = isReopenableTaskState(selectedTask.state) && nextState === "queued" ? true : undefined;
      const task = await updateTask(selectedTask.id, { state: nextState, reopened });
      updateTaskInList(task);
      setSelectedTaskId(task.id);
      setNextState("");
      const events = await listTaskEvents(task.id);
      setEventsState({ status: "ready", data: events });
    } catch (error) {
      setStateMessage(errorMessage(error));
    } finally {
      setUpdating(false);
    }
  }

  async function handleRunHermes() {
    if (!selectedTask) {
      return;
    }
    setRunnerBusy(true);
    setRunnerMessage(null);
    try {
      const result = await runTaskWithHermes(selectedTask.id);
      updateTaskInList(result.task);
      setSelectedTaskId(result.task.id);
      setRunnerSessionState({ status: "ready", data: result.session });
      setRunnerMessage(
        result.reused
          ? `Existing Hermes session ${shortId(result.session.id)} is still active.`
          : `Hermes session ${shortId(result.session.id)} queued.`
      );
      setEventsState({ status: "ready", data: await listTaskEvents(result.task.id) });
    } catch (error) {
      setRunnerMessage(errorMessage(error));
    } finally {
      setRunnerBusy(false);
    }
  }

  async function handleStopHermes() {
    if (!selectedTask) {
      return;
    }
    if (!window.confirm("Stop the active Hermes run for this task?")) {
      return;
    }

    setRunnerBusy(true);
    setRunnerMessage(null);
    try {
      const result = await stopTaskHermes(selectedTask.id, "Stop requested from Frank task detail.");
      updateTaskInList(result.task);
      setRunnerSessionState({ status: "ready", data: result.session });
      setRunnerMessage(result.stopResult.message);
      setEventsState({ status: "ready", data: await listTaskEvents(result.task.id) });
    } catch (error) {
      setRunnerMessage(errorMessage(error));
    } finally {
      setRunnerBusy(false);
    }
  }

  function updateTaskInList(task: Task) {
    setTasksState((current) =>
      current.status === "ready"
        ? { status: "ready", data: current.data.map((row) => (row.id === task.id ? task : row)) }
        : current
    );
  }

  return (
    <section className="grid gap-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
        <SectionCard
          title="Task Queue"
          description="Create work, inspect state, and hand selected tasks to Hermes when operator execution is needed."
          icon={<ListTodo aria-hidden="true" />}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => loadTasks()} disabled={tasksState.status === "loading"}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
          }
        >
          {tasksState.status === "loading" ? <LoadingBlock rows={5} /> : null}
          {tasksState.status === "error" ? <ResourceError message={tasksState.message} onRetry={() => loadTasks()} /> : null}
          {tasksState.status === "ready" ? (
            <DataTable
              data={tasks}
              getRowId={(task) => task.id}
              emptyState={
                <EmptyState
                  icon={<ListTodo aria-hidden="true" />}
                  title="No tasks yet"
                  description="Create a task to start tracking work in Frank Hub."
                />
              }
              columns={[
                {
                  id: "title",
                  header: "Task",
                  cell: (task) => (
                    <button
                      type="button"
                      className="grid max-w-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <span className="font-semibold text-foreground">{task.title}</span>
                      {task.description ? (
                        <span className="truncate text-sm text-muted-foreground">{task.description}</span>
                      ) : null}
                    </button>
                  )
                },
                {
                  id: "state",
                  header: "State",
                  cell: (task) => <StatusBadge tone={taskStateTone(task.state)}>{titleize(task.state)}</StatusBadge>
                },
                {
                  id: "execution",
                  header: "Execution",
                  cell: (task) => <span className="text-muted-foreground">{titleize(task.executionKind ?? "manual_lifecycle")}</span>
                },
                {
                  id: "priority",
                  header: "Priority",
                  className: "text-right",
                  cell: (task) => <span className="font-medium text-foreground">{task.priority}</span>
                },
                {
                  id: "updated",
                  header: "Updated",
                  cell: (task) => <span className="text-muted-foreground">{formatDateTime(task.updatedAt)}</span>
                }
              ]}
            />
          ) : null}
        </SectionCard>

        <SectionCard title="Create Task" description="Creates a draft task. Run it with Hermes from the task detail." icon={<Plus aria-hidden="true" />}>
          <form className="grid gap-4" onSubmit={handleCreateTask}>
            {createMessage ? (
              <Alert variant="destructive">
                <AlertTitle>Task not created</AlertTitle>
                <AlertDescription>{createMessage}</AlertDescription>
              </Alert>
            ) : null}
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Title
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Review project notes" />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Description
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional context"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Priority
              <Input
                type="number"
                min={0}
                max={1000}
                step={1}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={creating}>
              <Plus aria-hidden="true" />
              {creating ? "Creating" : "Create Draft"}
            </Button>
          </form>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(22rem,0.7fr)_minmax(0,1.3fr)]">
        <SectionCard
          title="Selected Task"
          description="State controls and Hermes operator actions for the selected task."
          icon={<Workflow aria-hidden="true" />}
          action={
            selectedTask ? (
              <StatusBadge tone={taskStateTone(selectedTask.state)}>{titleize(selectedTask.state)}</StatusBadge>
            ) : null
          }
        >
          {selectedTask ? (
            <div className="grid gap-4">
              <KeyValueList
                items={[
                  { label: "Title", value: selectedTask.title },
                  { label: "Priority", value: selectedTask.priority },
                  { label: "Execution", value: titleize(selectedTask.executionKind ?? "manual_lifecycle") },
                  { label: "Runner session", value: selectedRunnerSessionId ? shortId(selectedRunnerSessionId) : "None" },
                  { label: "Created", value: formatDateTime(selectedTask.createdAt) },
                  { label: "Updated", value: formatDateTime(selectedTask.updatedAt) },
                  { label: "Assigned agent", value: selectedTask.assignedAgentId ?? "Unassigned" }
                ]}
              />
              {stateMessage ? (
                <Alert variant="destructive">
                  <AlertTitle>State not updated</AlertTitle>
                  <AlertDescription>{stateMessage}</AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Select value={nextState} onValueChange={(value) => setNextState(value as TaskState)}>
                  <SelectTrigger disabled={transitionOptions.length === 0 || updating}>
                    <SelectValue placeholder="Choose next state" />
                  </SelectTrigger>
                  <SelectContent>
                    {transitionOptions.map((state) => (
                      <SelectItem key={state} value={state}>
                        {titleize(state)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" onClick={handleStateChange} disabled={!nextState || updating}>
                  <Send aria-hidden="true" />
                  {updating ? "Updating" : "Apply"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void handleRunHermes()} disabled={runnerBusy || runnerActive}>
                  <Bot aria-hidden="true" />
                  Run with Hermes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleStopHermes()}
                  disabled={runnerBusy || !runnerActive}
                >
                  <Square aria-hidden="true" />
                  Stop Hermes
                </Button>
              </div>
              {runnerMessage ? (
                <Alert variant={runnerMessage.toLowerCase().includes("failed") ? "destructive" : "default"}>
                  <AlertTitle>Hermes action</AlertTitle>
                  <AlertDescription>{runnerMessage}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : (
            <EmptyState
              icon={<Workflow aria-hidden="true" />}
              title="No task selected"
              description="Select a task from the queue to inspect its state and event history."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Task Events"
          description="Append-only task history recorded by Frank."
          icon={<Clock aria-hidden="true" />}
        >
          {eventsState.status === "loading" ? <LoadingBlock rows={4} /> : null}
          {eventsState.status === "error" ? <ResourceError message={eventsState.message} /> : null}
          {eventsState.status === "ready" ? (
            <DataTable
              data={eventsState.data}
              getRowId={(event) => event.id}
              emptyState={
                <EmptyState
                  icon={<Clock aria-hidden="true" />}
                  title="No task events"
                  description="Task state changes and runner events will appear here."
                />
              }
              columns={[
                {
                  id: "time",
                  header: "Time",
                  cell: (event) => <span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span>
                },
                {
                  id: "event",
                  header: "Event",
                  cell: (event) => <span className="font-semibold text-foreground">{event.eventType}</span>
                },
                {
                  id: "actor",
                  header: "Actor",
                  cell: (event) => <span className="text-muted-foreground">{titleize(event.actorType)}</span>
                },
                {
                  id: "state",
                  header: "State",
                  cell: (event) => <span>{stateChangeLabel(event)}</span>
                },
                {
                  id: "metadata",
                  header: "Metadata",
                  cell: (event) => (
                    <span className="text-muted-foreground">{metadataPreview(event.metadata, 1)[0]?.value ?? "None"}</span>
                  )
                }
              ]}
            />
          ) : null}
        </SectionCard>
      </section>

      {selectedTask ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
          <SectionCard
            title="Hermes Run Logs"
            description="Polling logs from Frank runner events. Secrets are redacted by the API before display."
            icon={<ScrollText aria-hidden="true" />}
            action={
              runnerSession ? (
                <StatusBadge tone={runnerStatusTone(runnerSession.status)}>{titleize(runnerSession.status)}</StatusBadge>
              ) : null
            }
          >
            {runnerLogsState.status === "loading" ? <LoadingBlock rows={4} /> : null}
            {runnerLogsState.status === "error" ? <ResourceError message={runnerLogsState.message} /> : null}
            {runnerLogsState.status === "ready" ? (
              <DataTable
                data={runnerLogsState.data.logs}
                getRowId={(log, index) => `${log.sequence}-${log.createdAt}-${index}`}
                emptyState={
                  <EmptyState
                    icon={<ScrollText aria-hidden="true" />}
                    title="No Hermes logs"
                    description="Run the selected task with Hermes to stream operator output into Frank."
                  />
                }
                columns={[
                  {
                    id: "time",
                    header: "Time",
                    cell: (log) => <span className="text-muted-foreground">{formatDateTime(log.createdAt)}</span>
                  },
                  {
                    id: "severity",
                    header: "Level",
                    cell: (log) => <StatusBadge tone={logSeverityTone(log.severity)}>{titleize(log.severity)}</StatusBadge>
                  },
                  {
                    id: "message",
                    header: "Message",
                    cell: (log) => (
                      <div className="grid gap-1">
                        <span className="font-medium text-foreground">{log.message}</span>
                        <span className="text-xs text-muted-foreground">
                          {titleize(log.source)} / {log.eventType}
                        </span>
                      </div>
                    )
                  }
                ]}
              />
            ) : null}
          </SectionCard>

          <div className="grid gap-5">
            <SectionCard title="Final Result" description="Final output captured from the Hermes session." icon={<FileText aria-hidden="true" />}>
              {runnerSessionState.status === "loading" ? <LoadingBlock rows={3} /> : null}
              {runnerSessionState.status === "error" ? <ResourceError message={runnerSessionState.message} /> : null}
              {runnerSessionState.status === "ready" ? (
                runnerSession?.finalOutput ? (
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm leading-6 text-foreground">
                    {runnerSession.finalOutput}
                  </pre>
                ) : (
                  <EmptyState title="No final output yet" description="Hermes final reports appear here after the worker closes the run." />
                )
              ) : null}
            </SectionCard>

            <SectionCard title="Artifacts" description="Reports and generated files captured by Frank." icon={<Download aria-hidden="true" />}>
              {artifactsState.status === "loading" ? <LoadingBlock rows={3} /> : null}
              {artifactsState.status === "error" ? <ResourceError message={artifactsState.message} /> : null}
              {artifactsState.status === "ready" ? (
                <DataTable
                  data={artifactsState.data}
                  getRowId={(artifact) => artifact.id}
                  emptyState={<EmptyState title="No artifacts" description="Captured reports and files will be listed here." />}
                  columns={[
                    {
                      id: "name",
                      header: "Name",
                      cell: (artifact) => (
                        <div className="grid gap-1">
                          <span className="font-medium text-foreground">{artifact.name}</span>
                          <span className="text-xs text-muted-foreground">{titleize(artifact.artifactType)}</span>
                        </div>
                      )
                    },
                    {
                      id: "size",
                      header: "Size",
                      cell: (artifact) => <span className="text-muted-foreground">{formatBytes(artifact.sizeBytes)}</span>
                    },
                    {
                      id: "download",
                      header: "",
                      className: "text-right",
                      cell: (artifact) => (
                        <Button asChild variant="outline" size="sm">
                          <a href={getArtifactDownloadUrl(artifact.downloadPath)}>
                            <Download aria-hidden="true" />
                            Open
                          </a>
                        </Button>
                      )
                    }
                  ]}
                />
              ) : null}
            </SectionCard>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function taskStateTone(state: TaskState): StatusTone {
  if (state === "completed") return "healthy";
  if (state === "failed" || state === "cancelled") return "offline";
  if (state === "blocked" || state === "waiting_approval") return "degraded";
  if (state === "queued" || state === "running") return "checking";
  return "neutral";
}

function runnerStatusTone(status: RunnerSession["status"]): StatusTone {
  if (status === "completed") return "healthy";
  if (status === "failed" || status === "cancelled" || status === "blocked") return "offline";
  if (activeRunnerStatuses.has(status)) return "checking";
  return "neutral";
}

function logSeverityTone(severity: RunnerLogEntry["severity"]): StatusTone {
  if (severity === "success") return "healthy";
  if (severity === "warning") return "degraded";
  if (severity === "error") return "offline";
  return "neutral";
}

function stateChangeLabel(event: TaskEvent): string {
  if (event.fromState && event.toState) {
    return `${titleize(event.fromState)} -> ${titleize(event.toState)}`;
  }
  if (event.toState) {
    return titleize(event.toState);
  }
  return summarizeValue(event.metadata);
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to complete the request.";
}
