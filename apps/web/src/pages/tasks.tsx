import { Clock, ListTodo, Plus, RefreshCw, Send, Workflow } from "lucide-react";
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
import { createTask, listTaskEvents, listTasks, updateTask, type Task, type TaskEvent } from "../api.js";
import { formatDateTime, metadataPreview, summarizeValue, titleize } from "../lib/format.js";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export function TasksPage() {
  const [tasksState, setTasksState] = useState<LoadState<Task[]>>({ status: "loading" });
  const [eventsState, setEventsState] = useState<LoadState<TaskEvent[]>>({ status: "ready", data: [] });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("100");
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [stateMessage, setStateMessage] = useState<string | null>(null);
  const [nextState, setNextState] = useState<TaskState | "">("");
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);

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

  const transitionOptions = selectedTask ? TASK_STATE_TRANSITIONS[selectedTask.state] : [];

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
      setTasksState((current) =>
        current.status === "ready"
          ? { status: "ready", data: current.data.map((row) => (row.id === task.id ? task : row)) }
          : current
      );
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

  return (
    <section className="grid gap-5">
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
        <SectionCard
          title="Task Queue"
          description="Manual intake and task state visibility. Agent execution remains outside this surface."
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
                  description="Create a manual task to start tracking work in Frank Hub."
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

        <SectionCard title="Create Task" description="Creates a draft task only." icon={<Plus aria-hidden="true" />}>
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
          description="Conservative state changes only; no agent execution controls are exposed."
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
          description="Events are read from the selected task history."
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
                  description="Task state changes and manual events will appear here."
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

function stateChangeLabel(event: TaskEvent): string {
  if (event.fromState && event.toState) {
    return `${titleize(event.fromState)} -> ${titleize(event.toState)}`;
  }
  if (event.toState) {
    return titleize(event.toState);
  }
  return summarizeValue(event.metadata);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to complete the request.";
}
