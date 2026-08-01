import type { PipelineSpec, SpecError } from "./types";

const ID_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

/**
 * Validate a PipelineSpec before layout. Pure and synchronous so hosts can
 * fail fast (and tests can assert) without rendering anything.
 */
export function validateSpec(spec: PipelineSpec): SpecError[] {
  const errors: SpecError[] = [];

  if (!spec.id) errors.push({ at: "id", message: "Spec requires an id." });
  else if (!ID_PATTERN.test(spec.id)) {
    errors.push({ at: "id", message: `Spec id must be lowercase dot-separated (got "${spec.id}").` });
  }
  if (!spec.title.trim()) errors.push({ at: "title", message: "Spec requires a title." });
  if (spec.nodes.length === 0) {
    errors.push({ at: "nodes", message: "A pipeline needs at least one node." });
  }

  const seenNodes = new Set<string>();
  spec.nodes.forEach((node, index) => {
    const at = `nodes[${index}]`;
    if (!node.id) {
      errors.push({ at: `${at}.id`, message: "Node requires an id." });
    } else {
      if (!ID_PATTERN.test(node.id)) {
        errors.push({ at: `${at}.id`, message: `Node id must be lowercase dot-separated (got "${node.id}").` });
      }
      if (seenNodes.has(node.id)) {
        errors.push({ at: `${at}.id`, message: `Duplicate node id "${node.id}".` });
      }
      seenNodes.add(node.id);
    }
    if (!node.title.trim()) errors.push({ at: `${at}.title`, message: "Node requires a title." });
  });

  const seenEdges = new Set<string>();
  spec.edges.forEach((edge, index) => {
    const at = `edges[${index}]`;
    if (!edge.id) {
      errors.push({ at: `${at}.id`, message: "Edge requires an id." });
    } else if (seenEdges.has(edge.id)) {
      errors.push({ at: `${at}.id`, message: `Duplicate edge id "${edge.id}".` });
    } else {
      seenEdges.add(edge.id);
    }
    if (!seenNodes.has(edge.source)) {
      errors.push({ at: `${at}.source`, message: `Edge "${edge.id}" references unknown source node "${edge.source}".` });
    }
    if (!seenNodes.has(edge.target)) {
      errors.push({ at: `${at}.target`, message: `Edge "${edge.id}" references unknown target node "${edge.target}".` });
    }
    if (edge.source && edge.source === edge.target) {
      errors.push({ at: `${at}`, message: `Edge "${edge.id}" is a self-loop.` });
    }
  });

  return errors;
}
