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

export interface FlowSettings {
  /** When true, the orchestrator extracts SPO triples from each chat turn and
   *  prepends retrieved triples to the next turn's input as agent memory. */
  memoryEnabled?: boolean;
}

export interface FlowDef {
  id: FlowId;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  settings?: FlowSettings;
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
  /**
   * Invoke another node on the canvas as a tool. The target's events are
   * emitted on its own nodeId with channel:'tool-call' so the visualizer can
   * show the tool firing while the parent agent is "thinking".
   *
   * Optional — only orchestrators that run nodes in-process expose it. Plugins
   * that need it should throw a clear error when it's missing.
   */
  callTool?(targetNodeId: NodeId, input: unknown): Promise<unknown>;
}

export interface NodeRuntimeModule<TConfig = Record<string, unknown>, TIn = unknown, TOut = unknown> {
  run(ctx: RunCtx, config: TConfig, msg: TIn): Promise<TOut>;
}
