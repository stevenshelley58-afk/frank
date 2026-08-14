import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portableRoot = root.replaceAll("\\", "/");

const outputRoot = resolve(root, "web/graph");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await build({
  entryPoints: [resolve(root, "graph/graph-workbench.js")],
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

const packageMetadata = JSON.parse(await readFile(resolve(root, "node_modules/@maxgraph/core/package.json"), "utf8"));
if (packageMetadata.license !== "Apache-2.0") throw new Error("@maxgraph/core license is not Apache-2.0");
await copyFile(resolve(root, "node_modules/@maxgraph/core/LICENSE"), resolve(outputRoot, "maxgraph-APACHE-2.0.txt"));
