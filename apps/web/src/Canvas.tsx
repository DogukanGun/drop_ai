import { useCallback, useMemo, useRef } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useFlow, type FlowEdge, type FlowNode } from './store';
import { DropAINode } from './DropAINode';

const nodeTypes = { dropai: DropAINode };
const AGENT_TYPES = new Set(['llm-agent', 'llm-agent-claude']);
const TOOL_EDGE_STYLE = { strokeDasharray: '5,5', stroke: '#b07bff' } as const;

function CanvasInner() {
  const nodes = useFlow(s => s.nodes);
  const edges = useFlow(s => s.edges);
  const setNodes = useFlow(s => s.setNodes);
  const setEdges = useFlow(s => s.setEdges);
  const selectNode = useFlow(s => s.selectNode);
  const palette = useFlow(s => s.palette);

  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(prev => applyNodeChanges(changes, prev) as FlowNode[]),
    [setNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges(prev => applyEdgeChanges(changes, prev) as FlowEdge[]),
    [setEdges],
  );
  const onConnect = useCallback(
    (conn: Connection) => setEdges(prev => addEdge(conn, prev) as FlowEdge[]),
    [setEdges],
  );

  const isValidConnection = useCallback(
    (conn: Connection | FlowEdge) => {
      if (!conn.source || !conn.target) return false;
      if (conn.source === conn.target) return false;
      const src = nodes.find(n => n.id === conn.source);
      const tgt = nodes.find(n => n.id === conn.target);
      if (!src || !tgt) return false;
      const targetHandle = (conn as Connection).targetHandle ?? null;
      const sourceHandle = (conn as Connection).sourceHandle ?? null;
      if (sourceHandle === 'flow-in' || sourceHandle === 'tools') return false;
      if (targetHandle === 'tools') {
        return !AGENT_TYPES.has(src.data.type);
      }
      if (targetHandle === 'flow-in' || targetHandle === null) {
        return sourceHandle === 'flow-out' || sourceHandle === null;
      }
      return false;
    },
    [nodes],
  );

  const styledEdges = useMemo(
    () =>
      edges.map(e =>
        e.targetHandle === 'tools'
          ? { ...e, animated: true, style: TOOL_EDGE_STYLE }
          : e,
      ),
    [edges],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/dropai-node-type');
      if (!type || !flowRef.current) return;
      const meta = palette.find(p => p.type === type);
      if (!meta) return;
      const position = flowRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = `${type}-${Math.random().toString(36).slice(2, 8)}`;
      const node: FlowNode = {
        id,
        type: 'dropai',
        position,
        data: {
          type: meta.type,
          label: meta.label,
          color: meta.color ?? '#6aa6ff',
          description: meta.description ?? '',
          config: { ...meta.defaults },
        },
      };
      setNodes(prev => [...prev, node]);
    },
    [setNodes, palette],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handlers = useMemo(
    () => ({
      onPaneClick: () => selectNode(null),
      onNodeClick: (_: React.MouseEvent, node: FlowNode) => selectNode(node.id),
    }),
    [selectNode],
  );

  return (
    <div className="canvas-wrap" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onInit={inst => (flowRef.current = inst)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onPaneClick={handlers.onPaneClick}
        onNodeClick={handlers.onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#262c39" gap={24} />
        <MiniMap pannable zoomable maskColor="rgba(7, 9, 13, 0.7)" style={{ background: '#0e1116' }} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
