import type { FlowDef, NodeId } from '@dropai/runtime-core';

/**
 * Kahn's algorithm. Returns nodes in execution order. Throws on cycles.
 */
export function topoSort(flow: FlowDef): NodeId[] {
  const indegree = new Map<NodeId, number>();
  const outgoing = new Map<NodeId, NodeId[]>();
  for (const n of flow.nodes) {
    indegree.set(n.id, 0);
    outgoing.set(n.id, []);
  }
  for (const e of flow.edges) {
    if (!indegree.has(e.target) || !outgoing.has(e.source)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    outgoing.get(e.source)!.push(e.target);
  }
  const queue: NodeId[] = [];
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id);
  const order: NodeId[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== flow.nodes.length) {
    throw new Error('Cycle detected in flow graph');
  }
  return order;
}

export function predecessors(flow: FlowDef, target: NodeId): NodeId[] {
  return flow.edges.filter(e => e.target === target).map(e => e.source);
}
