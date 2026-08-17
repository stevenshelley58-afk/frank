import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(root, "web/dashboard");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await build({
  entryPoints: [resolve(root, "dashboard/dashboard-vendor.js")],
  bundle: true,
  format: "iife",
  globalName: "FrankDashboardVendor",
  target: "es2020",
  outfile: resolve(outputRoot, "dashboard-vendor.js"),
  sourcemap: false,
  legalComments: "eof",
});

const packages = [
  ["gridstack", "MIT", "gridstack-MIT.txt"],
  ["echarts", "Apache-2.0", "echarts-APACHE-2.0.txt"],
];
for (const [name, expectedLicense, outputName] of packages) {
  const packageRoot = resolve(root, `node_modules/${name}`);
  const metadata = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  if (metadata.license !== expectedLicense) {
    throw new Error(`${name} license changed from ${expectedLicense}`);
  }
  await copyFile(resolve(packageRoot, "LICENSE"), resolve(outputRoot, outputName));
}
