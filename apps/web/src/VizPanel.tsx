import { useMemo, useState } from 'react';
import { Visualizer } from '@dropai/pulse';
import { useFlow } from './store';

/**
 * Default visualizer panel — auto-attached to every flow.
 *
 * Default mode is the Pulse canvas projector (tile per node, pulses on events).
 * A "log" toggle keeps the raw event stream available for debugging.
 */
export function VizPanel() {
  const events = useFlow(s => s.events);
  const nodes = useFlow(s => s.nodes);
  const runId = useFlow(s => s.runId);
  const [mode, setMode] = useState<'viz' | 'log'>('viz');

  const registrations = useMemo(
    () =>
      nodes.map(n => ({
        id: n.id,
        label: n.data.label,
        color: n.data.color,
      })),
    [nodes],
  );

  return (
    <section className="viz-panel">
      <header>
        <h2>Visualizer</h2>
        <span className="badge">pulse</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          default · auto-attached to every flow
        </span>
        <span style={{ flex: 1 }} />
        {runId && (
          <span style={{ color: 'var(--text-dim)', fontSize: 11, marginRight: 8 }}>
            run {runId}
          </span>
        )}
        <button
          onClick={() => setMode(mode === 'viz' ? 'log' : 'viz')}
          style={{
            background: 'var(--panel-2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '2px 8px',
            font: 'inherit',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {mode === 'viz' ? 'Show log' : 'Show viz'}
        </button>
      </header>
      <div className="canvas-host">
        {mode === 'viz' ? (
          <Visualizer events={events} nodes={registrations} />
        ) : (
          <EventLog />
        )}
      </div>
    </section>
  );
}

function EventLog() {
  const events = useFlow(s => s.events);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        padding: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.5,
        color: 'var(--text)',
      }}
    >
      {events.length === 0 && (
        <div style={{ color: 'var(--text-dim)' }}>No events yet — run a flow.</div>
      )}
      {events.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: 'var(--text-dim)' }}>
            {new Date(e.ts).toLocaleTimeString()}
          </span>
          <span style={{ color: kindColor(e.kind), width: 70 }}>{e.kind}</span>
          <span style={{ color: 'var(--accent)', width: 100 }}>{e.nodeId}</span>
          {e.channel && (
            <span style={{ color: 'var(--accent-2)', width: 50 }}>{e.channel}</span>
          )}
          <span style={{ flex: 1, opacity: 0.85, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {e.payload === undefined ? '' : JSON.stringify(e.payload)}
          </span>
        </div>
      ))}
    </div>
  );
}

function kindColor(kind: string): string {
  switch (kind) {
    case 'start': return 'var(--accent)';
    case 'progress': return 'var(--text-dim)';
    case 'output': return 'var(--ok)';
    case 'error': return 'var(--err)';
    case 'end': return 'var(--accent-2)';
    default: return 'var(--text)';
  }
}
