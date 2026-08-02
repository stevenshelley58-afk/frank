/**
 * Google Tasks connector — lightweight projection.
 * listTaskLists, listTasks, createTask, updateTask, completeTask, deleteTask.
 *
 * Plane is the source of truth for tasks; this surface only mirrors them to the
 * operator's phone via Google Tasks. Nothing here is authoritative.
 */
import { google, type tasks_v1 } from "googleapis";
import { getAuthClient } from "./auth.js";
import { toConnectorError } from "./errors.js";
import type {
  CompleteTaskParams,
  CreateTaskParams,
  DeleteTaskParams,
  ListTasksParams,
  ListTasksResult,
  Task,
  TaskList,
  UpdateTaskParams,
} from "./types.js";

const DEFAULT_TASKLIST = "@default";

function tasksClient() {
  return google.tasks({ version: "v1" });
}

function mapTask(t: tasks_v1.Schema$Task, tasklistId: string): Task {
  const completed = t.status === "completed";
  const base: Task = {
    id: t.id ?? "",
    tasklistId,
    title: t.title ?? "",
    status: completed ? "completed" : "needsAction",
    completed,
  };
  const o = base as { -readonly [K in keyof Task]: Task[K] };
  if (t.notes !== undefined && t.notes !== null) o.notes = t.notes;
  if (t.due !== undefined && t.due !== null) o.due = t.due;
  if (t.updated !== undefined && t.updated !== null) o.updated = t.updated;
  if (t.selfLink !== undefined && t.selfLink !== null) o.webLink = t.selfLink;
  if (t.parent !== undefined && t.parent !== null) o.parent = t.parent;
  if (t.position !== undefined && t.position !== null) o.position = t.position;
  return base;
}

export async function listTaskLists(): Promise<readonly TaskList[]> {
  try {
    const tasks = tasksClient();
    const res = await tasks.tasklists.list({
      auth: await getAuthClient(),
    });
    return (res.data.items ?? []).map((item): TaskList => {
      const base: TaskList = { id: item.id ?? "", title: item.title ?? "" };
      const o = base as { -readonly [K in keyof TaskList]: TaskList[K] };
      if (item.updated !== undefined && item.updated !== null) o.updated = item.updated;
      return base;
    });
  } catch (error) {
    throw toConnectorError(error, "tasks", "listTaskLists");
  }
}

export async function listTasks(params: ListTasksParams = {}): Promise<ListTasksResult> {
  const tasklist = params.tasklist ?? DEFAULT_TASKLIST;
  try {
    const tasks = tasksClient();
    const res = await tasks.tasks.list({
      auth: await getAuthClient(),
      tasklist,
      ...(params.maxResults !== undefined ? { maxResults: params.maxResults } : {}),
      ...(params.pageToken !== undefined ? { pageToken: params.pageToken } : {}),
      ...(params.dueMax !== undefined ? { dueMax: params.dueMax } : {}),
      ...(params.dueMin !== undefined ? { dueMin: params.dueMin } : {}),
      ...(params.showCompleted !== undefined ? { showCompleted: params.showCompleted } : {}),
      ...(params.showHidden !== undefined ? { showHidden: params.showHidden } : {}),
    });

    const result: ListTasksResult = {
      tasks: (res.data.items ?? []).map((t): Task => mapTask(t, tasklist)),
    };
    const o = result as { -readonly [K in keyof ListTasksResult]: ListTasksResult[K] };
    if (res.data.nextPageToken !== undefined && res.data.nextPageToken !== null) o.nextPageToken = res.data.nextPageToken;
    return result;
  } catch (error) {
    throw toConnectorError(error, "tasks", "listTasks");
  }
}

export async function createTask(params: CreateTaskParams): Promise<Task> {
  const tasklist = params.tasklist ?? DEFAULT_TASKLIST;
  try {
    const tasks = tasksClient();
    const requestBody: tasks_v1.Schema$Task = { title: params.title };
    if (params.notes !== undefined) requestBody.notes = params.notes;
    if (params.due !== undefined) requestBody.due = params.due;

    const res = await tasks.tasks.insert({
      auth: await getAuthClient(),
      tasklist,
      requestBody,
      ...(params.parent !== undefined ? { parent: params.parent } : {}),
    });
    return mapTask(res.data, tasklist);
  } catch (error) {
    throw toConnectorError(error, "tasks", "createTask");
  }
}

export async function updateTask(params: UpdateTaskParams): Promise<Task> {
  const tasklist = params.tasklist ?? DEFAULT_TASKLIST;
  try {
    const tasks = tasksClient();
    const requestBody: tasks_v1.Schema$Task = {};
    if (params.title !== undefined) requestBody.title = params.title;
    if (params.notes !== undefined) requestBody.notes = params.notes;
    if (params.due !== undefined) requestBody.due = params.due;

    const res = await tasks.tasks.patch({
      auth: await getAuthClient(),
      tasklist,
      task: params.taskId,
      requestBody,
    });
    return mapTask(res.data, tasklist);
  } catch (error) {
    throw toConnectorError(error, "tasks", "updateTask");
  }
}

export async function completeTask(params: CompleteTaskParams): Promise<void> {
  const tasklist = params.tasklist ?? DEFAULT_TASKLIST;
  try {
    const tasks = tasksClient();
    await tasks.tasks.patch({
      auth: await getAuthClient(),
      tasklist,
      task: params.taskId,
      requestBody: { status: "completed" },
    });
  } catch (error) {
    throw toConnectorError(error, "tasks", "completeTask");
  }
}

export async function reopenTask(params: CompleteTaskParams): Promise<void> {
  const tasklist = params.tasklist ?? DEFAULT_TASKLIST;
  try {
    const tasks = tasksClient();
    await tasks.tasks.patch({
      auth: await getAuthClient(),
      tasklist,
      task: params.taskId,
      requestBody: { status: "needsAction", completed: null },
    });
  } catch (error) {
    throw toConnectorError(error, "tasks", "reopenTask");
  }
}

export async function deleteTask(params: DeleteTaskParams): Promise<void> {
  const tasklist = params.tasklist ?? DEFAULT_TASKLIST;
  try {
    const tasks = tasksClient();
    await tasks.tasks.delete({
      auth: await getAuthClient(),
      tasklist,
      task: params.taskId,
    });
  } catch (error) {
    throw toConnectorError(error, "tasks", "deleteTask");
  }
}
