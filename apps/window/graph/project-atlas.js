import Graphology from "graphology";
import louvain from "graphology-communities-louvain";

const MAX_TOPICS = 8;
const TOPIC_COLORS = [
  { ink: "#174f43", fill: "#dbeae1", wash: "#edf5f0" },
  { ink: "#7a402d", fill: "#f0ddd1", wash: "#faf0ea" },
  { ink: "#32577b", fill: "#dce7f0", wash: "#edf3f7" },
  { ink: "#6a5631", fill: "#eee4ca", wash: "#f7f2e5" },
  { ink: "#65496d", fill: "#e8deea", wash: "#f4eef5" },
  { ink: "#315f64", fill: "#d9e9e9", wash: "#ecf5f5" },
  { ink: "#744f4d", fill: "#eadcda", wash: "#f6efee" },
  { ink: "#4f5a38", fill: "#e2e8d5", wash: "#f1f4ea" },
];

const DOMAIN_HINTS = [
  ["Agents & memory", /\b(agent|hermes|hindsight|memory|recall|codex|prompt|model)\b/i],
  ["Interface & experience", /\b(ui|ux|interface|screen|page|view|dashboard|frank|frontend|browser)\b/i],
  ["Runtime & operations", /\b(vps|docker|deploy|runtime|server|worker|job|trace|release|environment)\b/i],
  ["Code & architecture", /\b(code|repository|repo|module|function|class|architecture|database|api|service)\b/i],
  ["Rules & decisions", /\b(rule|policy|decision|requirement|approval|must|constraint|contract)\b/i],
  ["Providers & integrations", /\b(provider|integration|openrouter|github|fal|vercel|cloudflare|supabase)\b/i],
  ["Product & purpose", /\b(product|project|customer|user|campaign|property|real estate|blockwise|workflow)\b/i],
];

const cleanLabel = (value) => String(value || "Untitled").replace(/\s+/g, " ").trim();
const shortLabel = (value, max = 34) => {
  const label = cleanLabel(value);
  return label.length > max ? `${label.slice(0, max - 1).trim()}…` : label;
};

function domainName(nodes) {
  const scores = DOMAIN_HINTS.map(([name, pattern]) => ({
    name,
    score: nodes.reduce((total, node) => total + (pattern.test(node.label) ? 1 : 0), 0),
  })).sort((left, right) => right.score - left.score);
  if (scores[0]?.score >= Math.max(2, Math.ceil(nodes.length * 0.34))) return scores[0].name;
  const leaders = [...nodes]
    .sort((left, right) => right.mentions - left.mentions || left.label.localeCompare(right.label))
    .slice(0, 2)
    .map((node) => shortLabel(node.label, 23));
  if (leaders.length === 1) return leaders[0];
  return leaders.join(" & ");
}

function fallbackClusters(nodes) {
  const buckets = new Map();
  for (const node of nodes) {
    const hinted = DOMAIN_HINTS.find(([, pattern]) => pattern.test(node.label))?.[0] || "Project context";
    if (!buckets.has(hinted)) buckets.set(hinted, []);
    buckets.get(hinted).push(node);
  }
  return [...buckets.values()];
}

function detectedClusters(nodes, edges) {
  if (!edges.length) return fallbackClusters(nodes);
  try {
    const graph = new Graphology({ type: "undirected", multi: false, allowSelfLoops: false });
    nodes.forEach((node) => graph.addNode(node.id));
    const pairs = new Map();
    edges.forEach((edge) => {
      const ends = [edge.source, edge.target].sort();
      const id = JSON.stringify(ends);
      const existing = pairs.get(id) || { source: ends[0], target: ends[1], weight: 0 };
      existing.weight += edge.weight || 1;
      pairs.set(id, existing);
    });
    pairs.forEach((edge, id) => graph.addUndirectedEdgeWithKey(id, edge.source, edge.target, { weight: edge.weight }));
    const assignments = louvain(graph, { getEdgeWeight: "weight", randomWalk: false });
    const buckets = new Map();
    nodes.forEach((node) => {
      const clusterId = String(assignments[node.id] ?? node.id);
      if (!buckets.has(clusterId)) buckets.set(clusterId, []);
      buckets.get(clusterId).push(node);
    });
    const clusters = [...buckets.values()].filter((cluster) => cluster.length);
    return clusters.length ? clusters : fallbackClusters(nodes);
  } catch {
    return fallbackClusters(nodes);
  }
}

function limitClusters(clusters) {
  const ordered = [...clusters].sort((left, right) => right.length - left.length);
  if (ordered.length <= MAX_TOPICS) return ordered;
  const retained = ordered.slice(0, MAX_TOPICS - 1);
  retained.push(ordered.slice(MAX_TOPICS - 1).flat());
  return retained;
}

export function buildProjectAtlas(snapshot) {
  const rawNodes = (snapshot.nodes || []).map((node) => ({
    id: node.id,
    label: cleanLabel(node.label),
    mentions: Number(node.extensions?.["frank.graph.mentions"] || 0),
    original: node,
  }));
  const ids = new Set(rawNodes.map((node) => node.id));
  const rawEdges = (snapshot.edges || [])
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to)
    .map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      weight: Number(edge.extensions?.["frank.graph.weight"] || 1),
    }));
  const clusters = limitClusters(detectedClusters(rawNodes, rawEdges));
  const topicByNode = new Map();
  const topics = clusters.map((members, index) => {
    const id = `atlas-topic-${index + 1}`;
    const palette = TOPIC_COLORS[index % TOPIC_COLORS.length];
    const topic = {
      id,
      label: domainName(members),
      members,
      color: palette,
      relationshipCount: 0,
    };
    members.forEach((member) => topicByNode.set(member.id, topic));
    return topic;
  });
  const neighborIds = new Map(rawNodes.map((node) => [node.id, new Set()]));
  rawEdges.forEach((edge) => {
    neighborIds.get(edge.source)?.add(edge.target);
    neighborIds.get(edge.target)?.add(edge.source);
    const sourceTopic = topicByNode.get(edge.source);
    const targetTopic = topicByNode.get(edge.target);
    if (sourceTopic) sourceTopic.relationshipCount += 1;
    if (targetTopic && targetTopic !== sourceTopic) targetTopic.relationshipCount += 1;
  });
  const nodes = rawNodes.map((node) => {
    const topic = topicByNode.get(node.id);
    return {
      id: node.id,
      combo: topic?.id,
      data: {
        label: node.label,
        mentions: node.mentions,
        topicId: topic?.id,
        topicLabel: topic?.label || "Project context",
        neighborIds: [...(neighborIds.get(node.id) || [])],
        original: node.original,
      },
    };
  });
  const combos = topics.map((topic) => ({
    id: topic.id,
    data: {
      label: topic.label,
      count: topic.members.length,
      relationshipCount: topic.relationshipCount,
      color: topic.color,
      memberIds: topic.members.map((member) => member.id),
    },
    style: { collapsed: true },
  }));
  return {
    nodes,
    edges: rawEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: { weight: edge.weight },
    })),
    combos,
    topics,
    topicByNode,
    neighborIds,
  };
}

export { MAX_TOPICS };
