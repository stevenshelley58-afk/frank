/**
 * Symbol and relation extraction from Tree-sitter ASTs.
 *
 * Deterministic — no LLM. Walks the tree and pulls out:
 *  - functions, classes, methods, interfaces, types, variables
 *  - import declarations (file → file edges)
 *  - call expressions (symbol → symbol edges, best-effort)
 *  - extends / implements clauses
 *
 * IDs are stable: <relative-path>#<name> so they survive re-parses.
 */

import { relative } from "node:path";
import type Parser from "web-tree-sitter";
import type { CodeSymbol, Relation, SymbolKind } from "../types.js";

function nodeId(file: string, name: string): string {
  return `${file}#${name}`;
}

function relId(source: string, target: string, kind: string, line: number): string {
  return `${source}~${kind}~${target}@${line}`;
}

type ExtractResult = {
  symbols: CodeSymbol[];
  relations: Relation[];
  imports: string[];
};

/**
 * Walk a TypeScript / JavaScript tree and extract declarations.
 */
export function extractFromTree(
  tree: Parser.Tree,
  absPath: string,
  rootPath: string,
): ExtractResult {
  const rel = relative(rootPath, absPath).replace(/\\/g, "/");
  const symbols: CodeSymbol[] = [];
  const relations: Relation[] = [];
  const imports: string[] = [];

  function walk(node: Parser.SyntaxNode, parentId?: string) {
    switch (node.type) {
      case "function_declaration":
      case "generator_function_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (name) {
          const exported = node.parent?.type === "export_statement";
          symbols.push(mkSymbol(rel, name, "function", node, exported, parentId));
        }
        break;
      }
      case "class_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (name) {
          const exported = node.parent?.type === "export_statement";
          const id = nodeId(rel, name);
          symbols.push(mkSymbol(rel, name, "class", node, exported, parentId));

          // extends
          const heritage = node.children.find((c) => c.type === "class_heritage");
          if (heritage) {
            const ext = heritage.children.find((c) => c.type === "extends_clause");
            if (ext) {
              const target = ext.childForFieldName("value")?.text ?? ext.children[1]?.text;
              if (target) {
                relations.push({
                  id: relId(id, target, "extends", node.startPosition.row + 1),
                  source: id, target, kind: "extends",
                  file: rel, line: node.startPosition.row + 1,
                });
              }
            }
            const impl = heritage.children.find((c) => c.type === "implements_clause");
            if (impl) {
              for (const child of impl.children) {
                if (child.type === "type_identifier" || child.type === "identifier") {
                  relations.push({
                    id: relId(id, child.text, "implements", node.startPosition.row + 1),
                    source: id, target: child.text, kind: "implements",
                    file: rel, line: node.startPosition.row + 1,
                  });
                }
              }
            }
          }
          // Recurse into class body for methods
          const body = node.childForFieldName("body");
          if (body) walk(body, id);
          return; // don't double-walk children
        }
        break;
      }
      case "method_definition": {
        const name = node.childForFieldName("name")?.text;
        if (name && parentId) {
          symbols.push(mkSymbol(rel, name, "method", node, false, parentId));
        }
        break;
      }
      case "interface_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (name) {
          const exported = node.parent?.type === "export_statement";
          symbols.push(mkSymbol(rel, name, "interface", node, exported, parentId));
        }
        break;
      }
      case "type_alias_declaration": {
        const name = node.childForFieldName("name")?.text;
        if (name) {
          const exported = node.parent?.type === "export_statement";
          symbols.push(mkSymbol(rel, name, "type", node, exported, parentId));
        }
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        const exported = node.parent?.type === "export_statement";
        for (const child of node.children) {
          if (child.type === "variable_declarator") {
            const name = child.childForFieldName("name")?.text;
            if (name) {
              const valType = child.childForFieldName("value")?.type;
              const kind: SymbolKind =
                valType === "arrow_function" || valType === "function_expression"
                  ? "function"
                  : "variable";
              symbols.push(mkSymbol(rel, name, kind, child, exported, parentId));
            }
          }
        }
        break;
      }
      case "import_statement": {
        const source = node.childForFieldName("source");
        if (source) {
          const mod = source.text.replace(/["']/g, "");
          imports.push(mod);
          relations.push({
            id: relId(rel, mod, "imports", node.startPosition.row + 1),
            source: rel, target: mod, kind: "imports",
            file: rel, line: node.startPosition.row + 1,
          });
        }
        break;
      }
      case "call_expression": {
        const fn = node.childForFieldName("function");
        if (fn && parentId) {
          const callee = fn.text;
          // Skip trivial calls (console.log, etc)
          if (!callee.startsWith("console.") && callee.length < 80) {
            relations.push({
              id: relId(parentId, callee, "calls", node.startPosition.row + 1),
              source: parentId, target: callee, kind: "calls",
              file: rel, line: node.startPosition.row + 1,
            });
          }
        }
        break;
      }
    }

    for (const child of node.children) {
      walk(child, parentId);
    }
  }

  walk(tree.rootNode);
  return { symbols, relations, imports };
}

function mkSymbol(
  file: string,
  name: string,
  kind: SymbolKind,
  node: Parser.SyntaxNode,
  exported: boolean,
  parentId?: string,
): CodeSymbol {
  return {
    id: nodeId(file, name),
    name,
    kind,
    file,
    line: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    exported,
    parentId,
  };
}

/**
 * Extract from Python trees (simpler grammar).
 */
export function extractFromPythonTree(
  tree: Parser.Tree,
  absPath: string,
  rootPath: string,
): ExtractResult {
  const rel = relative(rootPath, absPath).replace(/\\/g, "/");
  const symbols: CodeSymbol[] = [];
  const relations: Relation[] = [];
  const imports: string[] = [];

  function walk(node: Parser.SyntaxNode, parentId?: string) {
    switch (node.type) {
      case "function_definition": {
        const name = node.childForFieldName("name")?.text;
        if (name) {
          const kind: SymbolKind = parentId ? "method" : "function";
          const exported = !name.startsWith("_");
          symbols.push(mkSymbol(rel, name, kind, node, exported, parentId));
          if (kind === "function") {
            const body = node.childForFieldName("body");
            if (body) walk(body, nodeId(rel, name));
            return;
          }
        }
        break;
      }
      case "class_definition": {
        const name = node.childForFieldName("name")?.text;
        if (name) {
          const id = nodeId(rel, name);
          symbols.push(mkSymbol(rel, name, "class", node, !name.startsWith("_"), parentId));
          const args = node.childForFieldName("superclasses");
          if (args) {
            for (const child of args.children) {
              if (child.type === "identifier" || child.type === "attribute") {
                relations.push({
                  id: relId(id, child.text, "extends", node.startPosition.row + 1),
                  source: id, target: child.text, kind: "extends",
                  file: rel, line: node.startPosition.row + 1,
                });
              }
            }
          }
          const body = node.childForFieldName("body");
          if (body) walk(body, id);
          return;
        }
        break;
      }
      case "import_statement":
      case "import_from_statement": {
        const mod = node.children.find(
          (c) => c.type === "dotted_name" || c.type === "relative_import",
        );
        if (mod) {
          imports.push(mod.text);
          relations.push({
            id: relId(rel, mod.text, "imports", node.startPosition.row + 1),
            source: rel, target: mod.text, kind: "imports",
            file: rel, line: node.startPosition.row + 1,
          });
        }
        break;
      }
    }
    for (const child of node.children) {
      walk(child, parentId);
    }
  }

  walk(tree.rootNode);
  return { symbols, relations, imports };
}
