import { useFlow } from './store';

const AGENT_TYPES = new Set(['llm-agent', 'llm-agent-claude']);

export function Inspector() {
  const selectedId = useFlow(s => s.selectedNodeId);
  const node = useFlow(s => s.nodes.find(n => n.id === selectedId));
  const palette = useFlow(s => s.palette);
  const updateNodeConfig = useFlow(s => s.updateNodeConfig);

  if (!node) {
    return (
      <aside className="inspector">
        <h2>Inspector</h2>
        <div className="empty">Select a node to edit its config.</div>
      </aside>
    );
  }

  const meta = palette.find(p => p.type === node.data.type);
  const isAgent = AGENT_TYPES.has(node.data.type);

  return (
    <aside className="inspector">
      <h2>{node.data.label}</h2>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 8 }}>
        {node.id}
      </div>
      {isAgent && (
        <div
          style={{
            fontSize: 11,
            color: '#b07bff',
            border: '1px dashed #b07bff',
            borderRadius: 4,
            padding: '6px 8px',
            marginBottom: 12,
            lineHeight: 1.4,
          }}
        >
          Wire tools into the dashed bottom handle of this node — each connected
          node becomes a callable tool the agent can invoke.
        </div>
      )}
      {meta?.configFields.map(field => {
        if (field.kind === 'nodeMultiSelect') return null;

        const value = (node.data.config[field.key] ?? '') as string;
        const onChange = (v: string) => updateNodeConfig(node.id, { [field.key]: v });
        return (
          <label key={field.key}>
            {field.label}
            {field.kind === 'textarea' && (
              <textarea
                value={value}
                placeholder={field.placeholder}
                onChange={e => onChange(e.target.value)}
              />
            )}
            {field.kind === 'text' && (
              <input
                type="text"
                value={value}
                placeholder={field.placeholder}
                onChange={e => onChange(e.target.value)}
              />
            )}
            {field.kind === 'password' && (
              <input
                type="password"
                value={value}
                placeholder={field.placeholder}
                onChange={e => onChange(e.target.value)}
              />
            )}
            {field.kind === 'select' && (
              <select value={value} onChange={e => onChange(e.target.value)}>
                {field.options.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </label>
        );
      })}
    </aside>
  );
}
