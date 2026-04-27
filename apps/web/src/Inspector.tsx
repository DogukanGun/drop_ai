import { useFlow } from './store';

export function Inspector() {
  const selectedId = useFlow(s => s.selectedNodeId);
  const node = useFlow(s => s.nodes.find(n => n.id === selectedId));
  const palette = useFlow(s => s.palette);
  const updateNodeConfig = useFlow(s => s.updateNodeConfig);
  const allNodes = useFlow(s => s.nodes);

  if (!node) {
    return (
      <aside className="inspector">
        <h2>Inspector</h2>
        <div className="empty">Select a node to edit its config.</div>
      </aside>
    );
  }

  const meta = palette.find(p => p.type === node.data.type);

  return (
    <aside className="inspector">
      <h2>{node.data.label}</h2>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 8 }}>
        {node.id}
      </div>
      {meta?.configFields.map(field => {
        if (field.kind === 'nodeMultiSelect') {
          const selected = (Array.isArray(node.data.config[field.key])
            ? (node.data.config[field.key] as string[])
            : []);
          const candidates = allNodes.filter(n => n.id !== node.id);
          return (
            <div key={field.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>
                {field.label}
              </div>
              {field.help && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6, opacity: 0.85 }}>
                  {field.help}
                </div>
              )}
              {candidates.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  Drop more nodes onto the canvas — they'll show up here as tools.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {candidates.map(n => {
                  const checked = selected.includes(n.id);
                  return (
                    <label
                      key={n.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 6px',
                        background: 'var(--panel-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        cursor: 'pointer',
                        marginBottom: 0,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...selected, n.id]
                            : selected.filter(x => x !== n.id);
                          updateNodeConfig(node.id, { [field.key]: next });
                        }}
                      />
                      <span
                        className="swatch"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: n.data.color,
                        }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{n.data.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                        {n.data.type}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        }

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
