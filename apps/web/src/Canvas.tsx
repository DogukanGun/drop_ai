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
        edges={edges}
        onInit={inst => (flowRef.current = inst)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
