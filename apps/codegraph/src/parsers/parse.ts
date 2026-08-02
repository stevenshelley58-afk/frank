/**
 * Tree-sitter WASM parser with language detection and incremental support.
 *
 * Uses web-tree-sitter (WASM) so it runs in any Node environment without
 * native compilation. Grammar WASMs come from the tree-sitter-wasms package.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Parser from "web-tree-sitter";

let initialized = false;
const languages: Record<string, Parser.Language> = {};

/** Map file extensions to grammar names. */
const EXT_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".json": "json",
};

export function detectLanguage(filePath: string): string | null {
  return EXT_MAP[extname(filePath).toLowerCase()] ?? null;
}

export async function initParser(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  initialized = true;
}

/**
 * Resolve the path to a grammar WASM file.
 * Uses createRequire from this module so pnpm's strict resolution finds
 * tree-sitter-wasms in the codegraph package's dependency tree.
 */
function resolveGrammarPath(name: string): string {
  const require = createRequire(import.meta.url);
  // tree-sitter-wasms exports its out/ directory; resolve the package then join
  const pkgPath = require.resolve("tree-sitter-wasms/package.json");
  return join(dirname(pkgPath), "out", `tree-sitter-${name}.wasm`);
}

async function loadLanguage(name: string): Promise<Parser.Language> {
  if (languages[name]) return languages[name];

  const wasmPath = resolveGrammarPath(name);
  const lang = await Parser.Language.load(wasmPath);
  languages[name] = lang;
  return lang;
}

export type ParseResult = {
  tree: Parser.Tree;
  language: string;
  hash: string;
};

/**
 * Parse a file, returning the syntax tree and a content hash.
 * The hash is SHA-256 of the file content — used for incremental detection.
 */
export async function parseFile(
  filePath: string,
  oldTree?: Parser.Tree,
): Promise<ParseResult | null> {
  const language = detectLanguage(filePath);
  if (!language) return null;

  await initParser();
  const lang = await loadLanguage(language);

  const content = await readFile(filePath, "utf-8");
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

  const parser = new Parser();
  parser.setLanguage(lang);

  const tree = parser.parse(content, oldTree);
  parser.delete();

  return { tree, language, hash };
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
