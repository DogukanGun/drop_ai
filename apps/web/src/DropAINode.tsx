import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FlowNode } from './store';
import { useFlow } from './store';

const AGENT_TYPES = new Set(['llm-agent', 'llm-agent-claude']);

export function DropAINode({ data, selected }: NodeProps<FlowNode>) {
  const palette = useFlow(s => s.palette);
  const meta = palette.find(p => p.type === data.type);
  const inputs = meta?.inputs ?? 1;
  const outputs = meta?.outputs ?? 1;
  const summary = summarize(data.config);
  const isAgent = AGENT_TYPES.has(data.type);

  return (
    <div className={`dropai-node ${selected ? 'selected' : ''}`}>
      {inputs > 0 && (
        <Handle id="flow-in" type="target" position={Position.Left} className="flow-in-handle" />
      )}
      <div className="node-header">
        <span className="swatch" style={{ background: data.color }} />
        <span className="label">{data.label}</span>
      </div>
      <div className="node-body">{summary || data.description}</div>
      {outputs > 0 && (
        <Handle id="flow-out" type="source" position={Position.Right} className="flow-out-handle" />
      )}
      {isAgent && (
        <Handle
          id="tools"
          type="target"
          position={Position.Bottom}
          className="tools-handle"
        />
      )}
    </div>
  );
}

function summarize(config: Record<string, unknown>): string {
  for (const key of ['task', 'text', 'payload', 'code', 'template']) {
    const v = config[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.length > 60 ? v.slice(0, 57) + '…' : v;
    }
  }
  return '';
}
