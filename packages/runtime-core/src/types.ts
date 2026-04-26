/**
 * Core types shared by editor, orchestrator, workers, and plugins.
 * Treat this file as the contract — changes here ripple everywhere.
 */

export type NodeId = string;
export type FlowId = string;
export type RunId = string;

export type RunnerKind = 'node' | 'python';

export type EventKind = 'start' | 'progress' | 'output' | 'error' | 'end';

export interface AgentEvent {
  flowRunId: RunId;
  nodeId: NodeId;
  ts: number;
  kind: EventKind;
  channel?: string;
  payload?: unknown;
}

export interface FlowNode {
  id: NodeId;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: NodeId;
  target: NodeId;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface FlowDef {
  id: FlowId;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type Message = {
  id: string;
  payload: unknown;
};

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RunSummary {
  id: RunId;
  flowId: FlowId;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/**
 * Manifest declared in each plugin's package.json under the "dropai" key.
 * The orchestrator scans /plugins/* for these and registers node types.
 */
export interface NodeManifest {
  type: string;
  category: string;
  label: string;
  description?: string;
  color?: string;
  icon?: string;
  inputs: number;
  outputs: number;
  runner: RunnerKind;
  /** Path (relative to package root) to the runtime entry. */
  runtime: string;
  /** Path (relative to package root) to the frontend bundle. Optional for sink/source nodes. */
  frontend?: string;
  /** JSON Schema describing the node's config. Used to render the inspector form. */
  configSchema?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
}

export interface PluginPackage {
  name: string;
  version: string;
  packageRoot: string;
  manifest: NodeManifest;
}

/**
 * Runtime context passed to every node's run() function.
 * The python-runner mirrors this surface over its stdin/stdout bridge.
 */
export interface RunCtx {
  runId: RunId;
  nodeId: NodeId;
  signal: AbortSignal;
  emit(event: Omit<AgentEvent, 'flowRunId' | 'nodeId' | 'ts'>): void;
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown): void;
}

export interface NodeRuntimeModule<TConfig = Record<string, unknown>, TIn = unknown, TOut = unknown> {
  run(ctx: RunCtx, config: TConfig, msg: TIn): Promise<TOut>;
}
