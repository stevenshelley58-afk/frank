/**
 * @frank/codegraph — graph builder.
 *
 * Scans a project directory, parses every supported file with Tree-sitter,
 * and assembles a ProjectGraph. Supports incremental reparse: pass the
 * previous graph and only changed files (by hash) are re-parsed.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseFile, detectLanguage } from "../parsers/parse.js";
import { extractFromTree, extractFromPythonTree } from "./symbols.js";
import type { FileNode, ProjectGraph } from "../types.js";

const DEFAULT_IGNORE = [
  "node_modules", ".git", "dist", "build", ".next", ".turbo",
  "coverage", ".cache", "__pycache__", ".venv", "venv",
  ".frank-build", ".ua",
];

async function walkDir(
  dir: string,
  root: string,
  ignore: Set<string>,
): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (ignore.has(entry.name) || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkDir(full, root, ignore)));
    } else if (entry.isFile() && detectLanguage(full)) {
      results.push(full);
    }
  }
  return results;
}

export async function buildGraph(
  projectId: string,
  rootPath: string,
  ignorePatterns: string[] = [],
  previous?: ProjectGraph,
): Promise<ProjectGraph> {
  const ignore = new Set([...DEFAULT_IGNORE, ...ignorePatterns]);
  const files = await walkDir(rootPath, rootPath, ignore);
  const prevFiles = new Map(previous?.files.map((f) => [f.path, f]) ?? []);

  const fileNodes: FileNode[] = [];
  const allSymbols: ProjectGraph["symbols"] = [];
  const allRelations: ProjectGraph["relations"] = [];
  const errors: ProjectGraph["errors"] = [];

  for (const absPath of files) {
    const relPath = relative(rootPath, absPath).replace(/\\/g, "/");
    const prev = prevFiles.get(relPath);

    try {
      const fileStat = await stat(absPath);
      const content = await readFile(absPath, "utf-8");
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

      // Skip unchanged files — reuse previous parse
      if (prev && prev.hash === hash) {
        fileNodes.push(prev);
        const prevSyms = previous?.symbols.filter((s) => s.file === relPath) ?? [];
        const prevRels = previous?.relations.filter((r) => r.file === relPath) ?? [];
        allSymbols.push(...prevSyms);
        allRelations.push(...prevRels);
        continue;
      }

      const parsed = await parseFile(absPath);
      if (!parsed) continue;

      const lang = parsed.language;
      const extracted =
        lang === "python"
          ? extractFromPythonTree(parsed.tree, absPath, rootPath)
          : extractFromTree(parsed.tree, absPath, rootPath);

      parsed.tree.delete();

      fileNodes.push({
        id: relPath,
        path: relPath,
        language: lang,
        hash,
        symbols: extracted.symbols.map((s) => s.id),
        imports: extracted.imports,
        sizeBytes: fileStat.size,
        lastModified: fileStat.mtime.toISOString(),
      });

      allSymbols.push(...extracted.symbols);
      allRelations.push(...extracted.relations);
    } catch (err) {
      errors.push({
        file: relPath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    projectId,
    rootPath,
    generatedAt: new Date().toISOString(),
    fileCount: fileNodes.length,
    symbolCount: allSymbols.length,
    relationCount: allRelations.length,
    files: fileNodes,
    symbols: allSymbols,
    relations: allRelations,
    errors,
  };
}
