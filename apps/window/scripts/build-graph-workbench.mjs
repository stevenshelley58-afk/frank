import { build } from "esbuild";
import { access, copyFile, mkdir, readFile, rm } from "node:fs/promises";
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
  minify: true,
  sourcemap: false,
  legalComments: "eof",
});

const dependencies = [
  ["@antv/g6", "antv-g6-MIT.txt", "MIT"],
  ["graphology-communities-louvain", "graphology-communities-louvain-MIT.txt", "MIT"],
  ["@maxgraph/core", "maxgraph-APACHE-2.0.txt", "Apache-2.0"],
  ["sigma", "sigma-MIT.txt", "MIT"],
  ["graphology", "graphology-MIT.txt", "MIT"],
];
for (const [name, licenseFile, expectedLicense] of dependencies) {
  const packageRoot = resolve(root, "node_modules", name);
  const packageMetadata = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  if (packageMetadata.license !== expectedLicense) throw new Error(`${name} license is not ${expectedLicense}`);
  const licenseSource = resolve(packageRoot, "LICENSE");
  const licenseTextSource = resolve(packageRoot, "LICENSE.txt");
  let source = licenseTextSource;
  try { await access(licenseSource); source = licenseSource; } catch { /* package uses LICENSE.txt */ }
  await copyFile(source, resolve(outputRoot, licenseFile));
}
