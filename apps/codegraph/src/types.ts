/**
 * @frank/codegraph — data model.
 *
 * Structural graph types produced by Tree-sitter analysis.
 * The serializer converts these into PipelineSpec for the frontend,
 * but the internal model is richer (source spans, language, etc).
 */

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "variable"
  | "module"
  | "route"
  | "component";

export type CodeSymbol = {
  id: string;
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  endLine: number;
  /** Exported from its module? */
  exported: boolean;
  /** Parent symbol id (method → class, etc). */
  parentId?: string;
  /** One-line LLM summary, filled by enrichment pass. */
  summary?: string;
};

export type RelationKind =
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  | "uses_type"
  | "contains";

export type Relation = {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  /** Where the reference occurs. */
  file: string;
  line: number;
};

export type FileNode = {
  id: string;
  path: string;
  language: string;
  /** Content hash — drives incremental reparse. */
  hash: string;
  symbols: string[];
  imports: string[];
  sizeBytes: number;
  lastModified: string;
};

export type ProjectGraph = {
  projectId: string;
  rootPath: string;
  generatedAt: string;
  fileCount: number;
  symbolCount: number;
  relationCount: number;
  files: FileNode[];
  symbols: CodeSymbol[];
  relations: Relation[];
  /** Errors encountered during parse (non-fatal). */
  errors: Array<{ file: string; message: string }>;
};

export type ProjectRegistration = {
  id: string;
  name: string;
  path: string;
  /** Glob patterns to ignore. */
  ignore: string[];
  /** Auto-added or manually registered. */
  source: "auto" | "manual";
  registeredAt: string;
};

export type GraphDiff = {
  projectId: string;
  baseTimestamp: string;
  headTimestamp: string;
  addedSymbols: CodeSymbol[];
  removedSymbols: CodeSymbol[];
  modifiedSymbols: Array<{ before: CodeSymbol; after: CodeSymbol }>;
  addedRelations: Relation[];
  removedRelations: Relation[];
  addedFiles: FileNode[];
  removedFiles: FileNode[];
  modifiedFiles: string[];
};
