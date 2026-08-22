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
  { name: "Agents & memory", patterns: [/\b(agent|hermes|hindsight|memory|recall|codex|research|skill|tool|prompt)\b/i] },
  { name: "Interface & design system", patterns: [
    /\b(ui|ux|interface|screen|page|view|dashboard|frank|frontend|browser|component|layout)\b/i,
    /\b(button|colour|color|ink|font|spacing|token|css|design system|shadcn|tailwind|manrope|jetbrains|motion|reduced motion)\b/i,
  ] },
  { name: "Models & providers", patterns: [
    /\b(model|provider|inference|llm|open\s*router|open\s*ai|google|claude|gpt|gemini|escalation)\b/i,
    /\b(fal|vercel|cloudflare|supabase)\b/i,
  ] },
  { name: "Runtime & operations", patterns: [
    /\b(vps|docker|deploy|runtime|server|worker|job|trace|release|environment|operations)\b/i,
    /\b(container|production|staging|config|env|queue|storage)\b/i,
  ] },
  { name: "Code & architecture", patterns: [
    /\b(code|repository|repo|module|function|class|architecture|database|api|service)\b/i,
    /\b(source|schema|endpoint|route|python|javascript|typescript|next\s*js|sql|data)\b/i,
  ] },
  { name: "Rules & decisions", patterns: [
    /\b(rule|policy|decision|requirement|approval|must|constraint|contract)\b/i,
    /\b(owner|canonical|authoritative|prohibited|allowed)\b/i,
  ] },
  { name: "Quality & testing", patterns: [
    /\b(test|testing|quality|qa|audit|coverage|defect|verification|regression)\b/i,
    /\b(failure|check|fixture|assertion|acceptance)\b/i,
  ] },
  { name: "Creative production", patterns: [
    /\b(ad studio|ad library|creative|campaign|advert\w*|image|video|media|render|generation|meta)\b/i,
    /\b(asset|template|shot|scene|composition)\b/i,
  ] },
  { name: "Product & purpose", patterns: [
    /\b(product|project|customer|user|property|real estate|blockwise|workflow)\b/i,
    /\b(goal|purpose|feature|experience|audience|business)\b/i,
  ] },
];

const cleanLabel = (value) => String(value || "Untitled").replace(/\s+/g, " ").trim();
const searchableLabel = (value) => cleanLabel(value)
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/[._/\\-]+/g, " ");
const shortLabel = (value, max = 34) => {
  const label = cleanLabel(value);
  return label.length > max ? `${label.slice(0, max - 1).trim()}…` : label;
};

function domainScores(nodes) {
  return DOMAIN_HINTS.map((domain) => ({
    name: domain.name,
    score: nodes.reduce((total, node) => (
      total + domain.patterns.reduce((matches, pattern) => matches + (pattern.test(searchableLabel(node.label)) ? 1 : 0), 0)
    ), 0),
  })).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

function topicNames(clusters) {
  const baseNames = clusters.map((members) => (
    domainScores(members).find((candidate) => candidate.score > 0)?.name || "Project context"
  ));
  const seen = new Map();
  return baseNames.map((base) => {
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    if (occurrence === 1) return base;
    const related = `Related ${base.toLowerCase()}`;
    const name = occurrence === 2 ? related : `${related} ${occurrence - 1}`;
    return name;
  });
}

function fallbackClusters(nodes) {
  const buckets = new Map();
  for (const node of nodes) {
    const hinted = domainScores([node]).find((domain) => domain.score > 0)?.name || "Project context";
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
  const names = topicNames(clusters);
  const topicByNode = new Map();
  const topics = clusters.map((members, index) => {
    const id = `atlas-topic-${index + 1}`;
    const palette = TOPIC_COLORS[index % TOPIC_COLORS.length];
    const topic = {
      id,
      label: names[index],
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
