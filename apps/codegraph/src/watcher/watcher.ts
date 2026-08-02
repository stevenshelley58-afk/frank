/**
 * @frank/codegraph — file watcher.
 *
 * Watches registered project directories with chokidar. On change,
 * triggers an incremental rebuild of that project's graph and writes
 * the updated JSON to the output directory. Debounced to avoid
 * thrashing during saves or git operations.
 *
 * Writes three files per project:
 *   graph.json      — full ProjectGraph (pretty)
 *   graph.min.json  — full ProjectGraph (compact, for API reads)
 *   spec.json       — PipelineSpec for the frontend (compact)
 */

import { watch, type FSWatcher } from "chokidar";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildGraph } from "../graph/builder.js";
import { graphToPipelineSpec } from "../graph/serialize.js";
import type { ProjectGraph, ProjectRegistration } from "../types.js";

type WatcherCallbacks = {
  onRebuildStart?: (projectId: string) => void;
  onRebuildEnd?: (projectId: string, graph: ProjectGraph) => void;
  onError?: (projectId: string, error: Error) => void;
};

export class ProjectWatcher {
  private watchers = new Map<string, FSWatcher>();
  private graphs = new Map<string, ProjectGraph>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private building = new Set<string>();

  constructor(
    private outputDir: string,
    private callbacks: WatcherCallbacks = {},
  ) {}

  /** Start watching a registered project. */
  async addProject(reg: ProjectRegistration): Promise<ProjectGraph> {
    const graph = await buildGraph(reg.id, reg.path, reg.ignore);
    this.graphs.set(reg.id, graph);
    await this.writeOutputs(reg.id, graph);

    const watcher = watch(reg.path, {
      ignored: [
        /(^|[/\\])\../,
        "**/node_modules/**",
        "**/dist/**",
        "**/.git/**",
        "**/__pycache__/**",
        ...reg.ignore.map((p) => `**/${p}/**`),
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      depth: 20,
    });

    watcher.on("all", (_event, filePath) => {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|json)$/.test(filePath)) return;
      this.scheduleRebuild(reg);
    });

    this.watchers.set(reg.id, watcher);
    return graph;
  }

  /** Remove a project from watching. */
  async removeProject(projectId: string): Promise<void> {
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(projectId);
    }
    this.graphs.delete(projectId);
    const timer = this.debounceTimers.get(projectId);
    if (timer) clearTimeout(timer);
    this.debounceTimers.delete(projectId);
  }

  /** Force an immediate rebuild (used by the API's refresh endpoint). */
  async forceRebuild(reg: ProjectRegistration): Promise<ProjectGraph> {
    const timer = this.debounceTimers.get(reg.id);
    if (timer) clearTimeout(timer);
    return this.rebuild(reg);
  }

  /** Get the current graph for a project (from cache). */
  getGraph(projectId: string): ProjectGraph | undefined {
    return this.graphs.get(projectId);
  }

  /** Check if a project is currently rebuilding. */
  isBuilding(projectId: string): boolean {
    return this.building.has(projectId);
  }

  /** Stop all watchers. */
  async close(): Promise<void> {
    for (const [, watcher] of this.watchers) {
      await watcher.close();
    }
    this.watchers.clear();
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private scheduleRebuild(reg: ProjectRegistration): void {
    const existing = this.debounceTimers.get(reg.id);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      reg.id,
      setTimeout(() => {
        this.debounceTimers.delete(reg.id);
        void this.rebuild(reg);
      }, 1000),
    );
  }

  private async rebuild(reg: ProjectRegistration): Promise<ProjectGraph> {
    if (this.building.has(reg.id)) {
      return this.graphs.get(reg.id)!;
    }

    this.building.add(reg.id);
    this.callbacks.onRebuildStart?.(reg.id);

    try {
      const previous = this.graphs.get(reg.id);
      const graph = await buildGraph(reg.id, reg.path, reg.ignore, previous);
      this.graphs.set(reg.id, graph);
      await this.writeOutputs(reg.id, graph);
      this.callbacks.onRebuildEnd?.(reg.id, graph);
      return graph;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.callbacks.onError?.(reg.id, error);
      throw error;
    } finally {
      this.building.delete(reg.id);
    }
  }

  private async writeOutputs(projectId: string, graph: ProjectGraph): Promise<void> {
    const dir = join(this.outputDir, projectId);
    await mkdir(dir, { recursive: true });

    // Full graph (pretty + compact)
    await writeFile(join(dir, "graph.json"), JSON.stringify(graph, null, 2), "utf-8");
    await writeFile(join(dir, "graph.min.json"), JSON.stringify(graph), "utf-8");

    // PipelineSpec for the frontend — file-level view
    const spec = graphToPipelineSpec(graph);
    await writeFile(join(dir, "spec.json"), JSON.stringify(spec), "utf-8");
  }
}
