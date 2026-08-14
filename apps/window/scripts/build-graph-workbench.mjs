import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portableRoot = root.replaceAll("\\", "/");

await build({
  stdin: {
    contents: readFileSync(resolve(root, "graph/graph-workbench.js"), "utf8"),
    resolveDir: `${portableRoot}/graph`,
    sourcefile: "graph-workbench.js",
    loader: "js",
  },
  bundle: true,
  format: "esm",
  target: "es2020",
  loader: { ".gif": "file" },
  assetNames: "assets/[name]-[hash]",
  outfile: resolve(root, "web/graph/graph-workbench.bundle.js"),
  nodePaths: [`${portableRoot}/node_modules`],
  sourcemap: false,
  legalComments: "eof",
});
