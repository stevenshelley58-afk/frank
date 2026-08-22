export const MAXGRAPH_NODE_THRESHOLD = 120;
export const MAXGRAPH_EDGE_THRESHOLD = 240;
export function chooseGraphRenderer(snapshot, options = {}) {
  if (options.kind === "project") return "g6";
  return (snapshot?.nodes?.length || 0) > MAXGRAPH_NODE_THRESHOLD || (snapshot?.edges?.length || 0) > MAXGRAPH_EDGE_THRESHOLD ? "sigma" : "maxgraph";
}
