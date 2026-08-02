/**
 * @frank/codegraph — graph differ.
 *
 * Compares two ProjectGraph snapshots and produces a GraphDiff
 * that the frontend renders as green/red/yellow overlays.
 */

import type { CodeSymbol, FileNode, GraphDiff, ProjectGraph, Relation } from "../types.js";

export function diffGraphs(base: ProjectGraph, head: ProjectGraph): GraphDiff {
  const baseSymbols = new Map(base.symbols.map((s) => [s.id, s]));
  const headSymbols = new Map(head.symbols.map((s) => [s.id, s]));
  const baseRelations = new Map(base.relations.map((r) => [r.id, r]));
  const headRelations = new Map(head.relations.map((r) => [r.id, r]));
  const baseFiles = new Map(base.files.map((f) => [f.path, f]));
  const headFiles = new Map(head.files.map((f) => [f.path, f]));

  const addedSymbols: CodeSymbol[] = [];
  const removedSymbols: CodeSymbol[] = [];
  const modifiedSymbols: Array<{ before: CodeSymbol; after: CodeSymbol }> = [];
  const addedRelations: Relation[] = [];
  const removedRelations: Relation[] = [];
  const addedFiles: FileNode[] = [];
  const removedFiles: FileNode[] = [];
  const modifiedFiles: string[] = [];

  // Symbols
  for (const [id, sym] of headSymbols) {
    const prev = baseSymbols.get(id);
    if (!prev) {
      addedSymbols.push(sym);
    } else if (
      prev.line !== sym.line ||
      prev.endLine !== sym.endLine ||
      prev.kind !== sym.kind ||
      prev.exported !== sym.exported
    ) {
      modifiedSymbols.push({ before: prev, after: sym });
    }
  }
  for (const [id, sym] of baseSymbols) {
    if (!headSymbols.has(id)) removedSymbols.push(sym);
  }

  // Relations
  for (const [id, rel] of headRelations) {
    if (!baseRelations.has(id)) addedRelations.push(rel);
  }
  for (const [id, rel] of baseRelations) {
    if (!headRelations.has(id)) removedRelations.push(rel);
  }

  // Files
  for (const [path, file] of headFiles) {
    const prev = baseFiles.get(path);
    if (!prev) {
      addedFiles.push(file);
    } else if (prev.hash !== file.hash) {
      modifiedFiles.push(path);
    }
  }
  for (const [path, file] of baseFiles) {
    if (!headFiles.has(path)) removedFiles.push(file);
  }

  return {
    projectId: head.projectId,
    baseTimestamp: base.generatedAt,
    headTimestamp: head.generatedAt,
    addedSymbols,
    removedSymbols,
    modifiedSymbols,
    addedRelations,
    removedRelations,
    addedFiles,
    removedFiles,
    modifiedFiles,
  };
}
