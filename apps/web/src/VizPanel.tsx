import { useMemo, useState } from 'react';
import { Visualizer } from '@dropai/pulse';
import { useFlow } from './store';
import { ChatPanel } from './ChatPanel';

type Tab = 'chat' | 'pulse' | 'log';

/**
 * Bottom panel docked to every flow. Three views:
 *   - Chat:  talk to the flow as an agent (default)
 *   - Pulse: live canvas visualizer pulsing on each node event
 *   - Log:   raw event stream for debugging
 */
export function VizPanel() {
  const events = useFlow(s => s.events);
  const nodes = useFlow(s => s.nodes);
  const runId = useFlow(s => s.runId);
  const [tab, setTab] = useState<Tab>('chat');

  const registrations = useMemo(
    () => nodes.map(n => ({ id: n.id, label: n.data.label, color: n.data.color })),
    [nodes],
  );

  return (
    <section className="viz-panel">
      <header>
        <TabBtn label="Chat" active={tab === 'chat'} onClick={() => setTab('chat')} />
        <TabBtn label="Pulse" active={tab === 'pulse'} onClick={() => setTab('pulse')} />
        <TabBtn label="Log" active={tab === 'log'} onClick={() => setTab('log')} />
        <span style={{ flex: 1 }} />
        {runId && (
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>run {runId}</span>
        )}
      </header>
      <div className="canvas-host">
        {tab === 'chat' && <ChatPanel />}
        {tab === 'pulse' && <Visualizer events={events} nodes={registrations} />}
        {tab === 'log' && <EventLog />}
      </div>
    </section>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'var(--panel-2)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-dim)',
        border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
        borderRadius: 4,
        padding: '2px 10px',
        font: 'inherit',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
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
        <div style={{ color: 'var(--text-dim)' }}>No events yet — send a message in Chat.</div>
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
