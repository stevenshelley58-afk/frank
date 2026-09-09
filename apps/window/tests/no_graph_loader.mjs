export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes("graph-workbench.bundle.js")) {
    throw new Error(`Unexpected eager graph dependency: ${specifier}`);
  }
  return nextResolve(specifier, context);
}
