export const MAXGRAPH_NODE_THRESHOLD = 120;
export const MAXGRAPH_EDGE_THRESHOLD = 240;
export function chooseGraphRenderer(snapshot, options = {}) {
  // Knowledge graphs are deliberately Sigma-first, even when a small project
  // snapshot would fit maxGraph. Tool pipelines retain the compact renderer.
  if (snapshot?.lens === "knowledge.combined" || options?.lens === "knowledge.combined") return "sigma";
  return (snapshot?.nodes?.length || 0) > MAXGRAPH_NODE_THRESHOLD || (snapshot?.edges?.length || 0) > MAXGRAPH_EDGE_THRESHOLD ? "sigma" : "maxgraph";
}
