import { create } from 'zustand';
import type { Edge, Node } from '@xyflow/react';
import type { AgentEvent, FlowDef, FlowSettings } from '@dropai/runtime-core';
import { FALLBACK_PALETTE, type PaletteEntry } from './seedNodes';

export interface NodeData extends Record<string, unknown> {
  type: string;
  label: string;
  color: string;
  description: string;
  config: Record<string, unknown>;
}

export type FlowNode = Node<NodeData>;
export type FlowEdge = Edge;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  ts: number;
  /** Run id this message corresponds to (assistant + system rows). */
  runId?: string;
  pending?: boolean;
}

const STORAGE_KEY = 'dropai.flow.v0';

interface FlowState {
  flowId: string | null;
  flowName: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  settings: FlowSettings;
  selectedNodeId: string | null;
  events: AgentEvent[];
  runId: string | null;
  palette: PaletteEntry[];
  chat: ChatMessage[];
  setFlowId: (id: string | null) => void;
  setFlowName: (name: string) => void;
  setNodes: (updater: FlowNode[] | ((prev: FlowNode[]) => FlowNode[])) => void;
  setEdges: (updater: FlowEdge[] | ((prev: FlowEdge[]) => FlowEdge[])) => void;
  setSettings: (patch: Partial<FlowSettings>) => void;
  selectNode: (id: string | null) => void;
  updateNodeConfig: (id: string, patch: Record<string, unknown>) => void;
  saveLocal: () => void;
  loadLocal: () => void;
  clearEvents: () => void;
  pushEvent: (e: AgentEvent) => void;
  setRunId: (id: string | null) => void;
  setPalette: (palette: PaletteEntry[]) => void;
  appendChat: (msg: ChatMessage) => void;
  patchLastChat: (patch: Partial<ChatMessage>) => void;
  clearChat: () => void;
  toFlowDef: () => FlowDef;
}

export const useFlow = create<FlowState>((set, get) => ({
  flowId: null,
  flowName: 'Untitled flow',
  nodes: [],
  edges: [],
  settings: {},
  selectedNodeId: null,
  events: [],
  runId: null,
  palette: FALLBACK_PALETTE,
  chat: [],
  setFlowId: id => set({ flowId: id }),
  setFlowName: name => set({ flowName: name }),
  setNodes: updater =>
    set(state => ({
      nodes: typeof updater === 'function' ? updater(state.nodes) : updater,
    })),
  setEdges: updater =>
    set(state => ({
      edges: typeof updater === 'function' ? updater(state.edges) : updater,
    })),
  setSettings: patch => set(state => ({ settings: { ...state.settings, ...patch } })),
  selectNode: id => set({ selectedNodeId: id }),
  updateNodeConfig: (id, patch) =>
    set(state => ({
      nodes: state.nodes.map(n =>
        n.id === id
          ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } }
          : n,
      ),
    })),
  saveLocal: () => {
    const { flowId, flowName, nodes, edges, settings } = get();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ flowId, flowName, nodes, edges, settings }),
    );
  },
  loadLocal: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<{
        flowId: string;
        flowName: string;
        nodes: FlowNode[];
        edges: FlowEdge[];
        settings: FlowSettings;
      }>;
      set({
        flowId: parsed.flowId ?? null,
        flowName: parsed.flowName ?? 'Untitled flow',
        nodes: parsed.nodes ?? [],
        edges: parsed.edges ?? [],
        settings: parsed.settings ?? {},
        selectedNodeId: null,
      });
    } catch {
      // ignore corrupt local storage
    }
  },
  clearEvents: () => set({ events: [] }),
  pushEvent: e => set(state => ({ events: [...state.events, e].slice(-500) })),
  setRunId: id => set({ runId: id }),
  setPalette: palette => set({ palette }),
  appendChat: msg => set(state => ({ chat: [...state.chat, msg] })),
  patchLastChat: patch =>
    set(state => {
      if (state.chat.length === 0) return state;
      const next = [...state.chat];
      next[next.length - 1] = { ...next[next.length - 1]!, ...patch };
      return { chat: next };
    }),
  clearChat: () => set({ chat: [] }),
  toFlowDef: () => {
    const { flowId, flowName, nodes, edges, settings } = get();
    return {
      id: flowId ?? '',
      name: flowName,
      settings,
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.data.type,
        position: n.position,
        config: n.data.config,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      })),
    };
  },
}));
