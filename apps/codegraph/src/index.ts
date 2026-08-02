/**
 * @frank/codegraph — entry point.
 *
 * A standalone background service that:
 *  1. Reads project registrations from CODEGRAPH_PROJECTS env or registry file
 *  2. Builds and watches each project's code graph
 *  3. Writes graph JSON to a shared volume the API reads from
 *  4. Exposes a tiny HTTP health/status endpoint on port 3002
 *
 * Designed to run as a Docker container alongside frank-api and frank-web.
 * Zero coupling to Frank's request path — it just writes files.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProjectWatcher } from "./watcher/watcher.js";
import type { ProjectRegistration } from "./types.js";

const OUTPUT_DIR = process.env.CODEGRAPH_OUTPUT ?? "/data/codegraph";
const REGISTRY_FILE = process.env.CODEGRAPH_REGISTRY ?? "/data/codegraph/projects.json";
const PORT = Number(process.env.CODEGRAPH_PORT ?? 3002);

/** Default projects to watch if no registry file exists yet. */
function defaultProjects(): ProjectRegistration[] {
  const frankRepo = process.env.CODEGRAPH_FRANK_REPO ?? "/srv/frank/repo";
  return [
    {
      id: "frank",
      name: "Frank Monorepo",
      path: frankRepo,
      ignore: ["node_modules", ".git", "dist", ".turbo", ".next"],
      source: "auto",
      registeredAt: new Date().toISOString(),
    },
  ];
}

async function loadProjects(): Promise<ProjectRegistration[]> {
  try {
    const raw = await readFile(REGISTRY_FILE, "utf-8");
    const parsed = JSON.parse(raw) as ProjectRegistration[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // No registry file or empty — use defaults
  }
  return defaultProjects();
}

async function main() {
  console.log("[codegraph] starting…");
  console.log(`[codegraph] output: ${OUTPUT_DIR}`);

  const watcher = new ProjectWatcher(OUTPUT_DIR, {
    onRebuildStart: (id) => console.log(`[codegraph] rebuild: ${id}`),
    onRebuildEnd: (id, graph) =>
      console.log(
        `[codegraph] done: ${id} — ${graph.fileCount} files, ${graph.symbolCount} symbols, ${graph.relationCount} relations`,
      ),
    onError: (id, err) => console.error(`[codegraph] error: ${id} — ${err.message}`),
  });

  const projects = await loadProjects();
  console.log(`[codegraph] watching ${projects.length} project(s)`);

  for (const reg of projects) {
    try {
      const graph = await watcher.addProject(reg);
      console.log(
        `[codegraph] initial: ${reg.id} — ${graph.fileCount} files, ${graph.symbolCount} symbols`,
      );
    } catch (err) {
      console.error(`[codegraph] failed to add ${reg.id}:`, err);
    }
  }

  // Health / status HTTP endpoint
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", projects: projects.length }));
      return;
    }
    if (req.url === "/status") {
      const statuses = projects.map((p) => ({
        id: p.id,
        path: p.path,
        building: watcher.isBuilding(p.id),
        graph: (() => {
          const g = watcher.getGraph(p.id);
          if (!g) return null;
          return {
            files: g.fileCount,
            symbols: g.symbolCount,
            relations: g.relationCount,
            generatedAt: g.generatedAt,
            errors: g.errors.length,
          };
        })(),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects: statuses }, null, 2));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(PORT, () => {
    console.log(`[codegraph] status endpoint: http://0.0.0.0:${PORT}/status`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[codegraph] shutting down…");
    await watcher.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[codegraph] fatal:", err);
  process.exit(1);
});
