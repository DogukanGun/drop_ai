import type { AgentEvent, FlowDef, FlowEdge, FlowNode, NodeId, RunCtx, RunId } from '@dropai/runtime-core';
import { eventBus } from './eventBus.js';
import { topoSort, predecessors } from './topoSort.js';
import { callNodeRuntime, nodeRegistry } from '../nodes/loader.js';
import { setRunStatus } from '../db/flows.js';
import { buildPromptWithMemory, ingestTurn } from './memory.js';

const AGENT_TYPES = new Set(['llm-agent', 'llm-agent-claude']);
const TOOLS_HANDLE = 'tools';

export interface RunHandle {
  runId: RunId;
  abort(): void;
  done: Promise<void>;
}

export interface RunOptions {
  /** Runtime input passed to every source node (no-incoming-edge node). */
  input?: unknown;
}

export function startRun(flow: FlowDef, runId: RunId, options: RunOptions = {}): RunHandle {
  const controller = new AbortController();
  const outputs = new Map<string, unknown>();
  const fullFlow = migrateLegacyTools(flow);
  const linearFlow: FlowDef = {
    ...fullFlow,
    edges: fullFlow.edges.filter(e => e.targetHandle !== TOOLS_HANDLE),
  };
  const sinkIds = sinks(linearFlow);
  const toolNodeIds = computeToolNodes(fullFlow);

  const memoryEnabled = Boolean(flow.settings?.memoryEnabled);
  const userText = typeof options.input === 'string' ? options.input : '';
  const runtimeInput =
    memoryEnabled && userText
      ? buildPromptWithMemory(flow.id, userText)
      : options.input;

  const done = (async () => {
    publishMeta(runId, 'meta', {
      kind: 'run-start',
      flowId: flow.id,
      memoryEnabled,
    });
    await setRunStatus(runId, 'running');
    try {
      // Tool nodes are excluded from linear execution; they only run when an
      // agent calls them via ctx.callTool.
      const order = topoSort(linearFlow).filter(id => !toolNodeIds.has(id));
      for (const nodeId of order) {
        if (controller.signal.aborted) throw new Error('aborted');
        const node = fullFlow.nodes.find(n => n.id === nodeId);
        if (!node) continue;
        const inputMsg = collectInput(linearFlow, nodeId, outputs, runtimeInput);
        const ctx: RunCtx = makeCtx(runId, nodeId, controller.signal, fullFlow);
        try {
          const config = injectAgentTools(node, fullFlow);
          const result = await callNodeRuntime(node.type, ctx, config, inputMsg);
          outputs.set(nodeId, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.emit({ kind: 'error', payload: { message } });
          throw err;
        }
      }
      await setRunStatus(runId, 'succeeded');
      const result = finalResult(sinkIds, outputs);
      publishMeta(runId, 'meta', { kind: 'run-end', status: 'succeeded', result });

      if (memoryEnabled && userText) {
        const reply = stringifyResult(result);
        if (reply) {
          // Don't block run-end on extraction; let it run in the background.
          void ingestTurn(flow.id, userText, reply).then(({ added }) => {
            if (added > 0) {
              publishMeta(runId, 'meta', { kind: 'memory-updated', added });
            }
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setRunStatus(runId, 'failed', message);
      publishMeta(runId, 'meta', { kind: 'run-end', status: 'failed', error: message });
    }
  })();

  return {
    runId,
    abort: () => controller.abort(),
    done,
  };
}

function stringifyResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    for (const key of ['finalText', 'reportMd', 'text', 'output']) {
      const v = r[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

function collectInput(
  flow: FlowDef,
  nodeId: string,
  outputs: Map<string, unknown>,
  runtimeInput: unknown,
): unknown {
  const preds = predecessors(flow, nodeId);
  if (preds.length === 0) return runtimeInput ?? null;
  if (preds.length === 1) return outputs.get(preds[0]!) ?? null;
  return preds.map(p => outputs.get(p) ?? null);
}

function sinks(flow: FlowDef): string[] {
  const hasOutgoing = new Set(flow.edges.map(e => e.source));
  return flow.nodes.map(n => n.id).filter(id => !hasOutgoing.has(id));
}

function finalResult(sinkIds: string[], outputs: Map<string, unknown>): unknown {
  if (sinkIds.length === 0) return null;
  if (sinkIds.length === 1) return outputs.get(sinkIds[0]!) ?? null;
  return Object.fromEntries(sinkIds.map(id => [id, outputs.get(id) ?? null]));
}

/** Source nodes of every edge that targets an agent's `tools` handle. */
function computeToolNodes(flow: FlowDef): Set<NodeId> {
  const ids = new Set<NodeId>();
  for (const e of flow.edges) {
    if (e.targetHandle === TOOLS_HANDLE) ids.add(e.source);
  }
  return ids;
}

/**
 * For llm-agent nodes, resolve the set of tools wired into their `tools`
 * handle into manifest summaries and inject into config so the plugin can
 * build OpenAI tool specs without needing access to the registry.
 */
function injectAgentTools(node: FlowNode, flow: FlowDef): Record<string, unknown> {
  if (!AGENT_TYPES.has(node.type)) return node.config;
  const byType = new Map(nodeRegistry.list().map(m => [m.type, m]));
  const resolved = flow.edges
    .filter(e => e.target === node.id && e.targetHandle === TOOLS_HANDLE)
    .map(e => flow.nodes.find(n => n.id === e.source))
    .filter((n): n is FlowNode => !!n)
    .map(n => {
      const m = byType.get(n.type);
      return {
        nodeId: n.id,
        type: n.type,
        label: m?.label ?? n.type,
        description: m?.description ?? '',
      };
    });
  return { ...node.config, _tools: resolved };
}

/**
 * Old flows persisted tools as `agent.config.tools: NodeId[]`. Materialize
 * those into synthetic edges into the agent's `tools` handle so the rest of
 * the executor sees a uniform shape. Read-time only; the persisted DB row
 * is left untouched.
 */
function migrateLegacyTools(flow: FlowDef): FlowDef {
  const extra: FlowEdge[] = [];
  let mutated = false;
  const nodes = flow.nodes.map(n => {
    if (!AGENT_TYPES.has(n.type)) return n;
    const legacy = Array.isArray(n.config?.tools) ? (n.config.tools as unknown[]) : null;
    if (!legacy || legacy.length === 0) return n;
    mutated = true;
    for (const id of legacy) {
      if (typeof id !== 'string') continue;
      extra.push({
        id: `legacy-tool-${n.id}-${id}`,
        source: id,
        target: n.id,
        targetHandle: TOOLS_HANDLE,
      });
    }
    const { tools: _drop, ...rest } = n.config as Record<string, unknown>;
    return { ...n, config: rest };
  });
  if (!mutated) return flow;
  return { ...flow, nodes, edges: [...flow.edges, ...extra] };
}

function makeCtx(runId: RunId, nodeId: string, signal: AbortSignal, flow: FlowDef): RunCtx {
  const ctx: RunCtx = {
    runId,
    nodeId,
    signal,
    emit(event) {
      const full: AgentEvent = {
        flowRunId: runId,
        nodeId,
        ts: Date.now(),
        kind: event.kind,
        channel: event.channel,
        payload: event.payload,
      };
      eventBus.publish(full);
    },
    log(level, message, meta) {
      console.log(`[${runId}] [${nodeId}] [${level}] ${message}`, meta ?? '');
    },
    async callTool(targetNodeId, input) {
      return invokeToolNode(flow, runId, signal, targetNodeId, input);
    },
  };
  return ctx;
}

/**
 * Run a single node as a tool call: child context tags every event on the
 * target's own nodeId with channel:'tool-call' so the visualizer animates
 * the right tile.
 */
async function invokeToolNode(
  flow: FlowDef,
  runId: RunId,
  signal: AbortSignal,
  targetNodeId: NodeId,
  input: unknown,
): Promise<unknown> {
  const target = flow.nodes.find(n => n.id === targetNodeId);
  if (!target) throw new Error(`callTool: no node with id "${targetNodeId}" in flow`);

  const childCtx: RunCtx = {
    runId,
    nodeId: target.id,
    signal,
    emit(event) {
      eventBus.publish({
        flowRunId: runId,
        nodeId: target.id,
        ts: Date.now(),
        kind: event.kind,
        channel: event.channel ?? 'tool-call',
        payload: event.payload,
      });
    },
    log(level, message, meta) {
      console.log(`[${runId}] [tool:${target.id}] [${level}] ${message}`, meta ?? '');
    },
    async callTool(nestedId, nestedInput) {
      return invokeToolNode(flow, runId, signal, nestedId, nestedInput);
    },
  };

  return callNodeRuntime(target.type, childCtx, target.config, input);
}

function publishMeta(runId: RunId, nodeId: string, payload: { kind: string; [k: string]: unknown }) {
  eventBus.publish({
    flowRunId: runId,
    nodeId,
    ts: Date.now(),
    kind: 'progress',
    channel: 'meta',
    payload,
  });
}
