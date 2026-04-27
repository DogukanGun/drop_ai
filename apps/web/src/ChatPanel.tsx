import { useEffect, useRef, useState } from 'react';
import { useFlow } from './store';
import { saveFlow, startRun, subscribeToRun } from './api';

/**
 * Chat tab — feeds each user message through the saved flow as runtime input
 * and renders the terminal-node output as the agent's reply.
 */
export function ChatPanel() {
  const flowId = useFlow(s => s.flowId);
  const nodes = useFlow(s => s.nodes);
  const chat = useFlow(s => s.chat);
  const appendChat = useFlow(s => s.appendChat);
  const patchLastChat = useFlow(s => s.patchLastChat);
  const clearChat = useFlow(s => s.clearChat);
  const clearEvents = useFlow(s => s.clearEvents);
  const pushEvent = useFlow(s => s.pushEvent);
  const setRunId = useFlow(s => s.setRunId);
  const setFlowId = useFlow(s => s.setFlowId);
  const toFlowDef = useFlow(s => s.toFlowDef);
  const memoryEnabled = useFlow(s => Boolean(s.settings.memoryEnabled));

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat]);

  useEffect(() => () => unsubRef.current?.(), []);

  const send = async () => {
    const userText = text.trim();
    if (!userText || busy || nodes.length === 0) return;

    setBusy(true);
    setText('');
    appendChat({ role: 'user', text: userText, ts: Date.now() });
    appendChat({ role: 'assistant', text: '…', ts: Date.now(), pending: true });

    try {
      // Persist the flow so the orchestrator has the latest graph + settings.
      let id = flowId;
      const saved = await saveFlow(toFlowDef());
      id = saved.id;
      setFlowId(id);

      clearEvents();
      const { runId } = await startRun(id, { input: userText });
      setRunId(runId);

      const reply = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('run timeout')), 5 * 60_000);
        unsubRef.current?.();
        unsubRef.current = subscribeToRun(runId, ev => {
          pushEvent(ev);
          if (ev.channel !== 'meta') return;
          const payload = ev.payload as
            | { kind?: string; status?: string; error?: string; result?: unknown }
            | undefined;
          if (payload?.kind === 'run-end') {
            clearTimeout(timeout);
            if (payload.status === 'succeeded') {
              resolve(stringifyResult(payload.result));
            } else {
              reject(new Error(payload.error || 'run failed'));
            }
          }
        });
      });

      patchLastChat({ text: reply || '(empty response)', pending: false });
    } catch (err) {
      patchLastChat({
        text: 'Error: ' + (err instanceof Error ? err.message : String(err)),
        pending: false,
        role: 'system',
      });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  if (nodes.length === 0) {
    return (
      <div style={emptyStyle}>
        Build a flow on the canvas, then chat with it here.
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {chat.length === 0 && (
          <div style={emptyStyle}>
            Type a message below — it will be passed as input to your flow.
            {memoryEnabled && (
              <div style={{ marginTop: 6, color: 'var(--accent-2)' }}>Memory is on: prior turns inform the next.</div>
            )}
          </div>
        )}
        {chat.map((m, i) => (
          <Bubble key={i} msg={m} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderTop: '1px solid var(--border)', background: 'var(--panel)' }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? 'Agent is thinking…' : 'Message the agent (Enter to send, Shift+Enter for newline)'}
          disabled={busy}
          rows={1}
          style={{
            flex: 1,
            background: 'var(--panel-2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 8px',
            font: 'inherit',
            resize: 'none',
            minHeight: 32,
            maxHeight: 120,
          }}
        />
        <button
          onClick={send}
          disabled={busy || !text.trim()}
          style={{
            background: 'var(--accent)',
            color: '#08111f',
            border: '1px solid var(--accent)',
            borderRadius: 6,
            padding: '0 14px',
            cursor: busy || !text.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !text.trim() ? 0.5 : 1,
            font: 'inherit',
            fontWeight: 600,
          }}
        >
          Send
        </button>
        <button
          onClick={clearChat}
          disabled={busy || chat.length === 0}
          title="Clear chat"
          style={{
            background: 'var(--panel-2)',
            color: 'var(--text-dim)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '0 10px',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  margin: 'auto',
  color: 'var(--text-dim)',
  fontSize: 12,
  textAlign: 'center',
  padding: 24,
};

function Bubble({ msg }: { msg: { role: string; text: string; pending?: boolean } }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const align = isUser ? 'flex-end' : 'flex-start';
  const bg = isSystem
    ? 'rgba(255,111,111,0.15)'
    : isUser
      ? 'var(--accent)'
      : 'var(--panel)';
  const color = isUser ? '#08111f' : isSystem ? 'var(--err)' : 'var(--text)';
  const border = isSystem ? '1px solid rgba(255,111,111,0.4)' : '1px solid var(--border)';
  return (
    <div style={{ display: 'flex', justifyContent: align }}>
      <div
        style={{
          maxWidth: '85%',
          background: bg,
          color,
          border,
          borderRadius: 10,
          padding: '6px 10px',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          opacity: msg.pending ? 0.6 : 1,
          fontStyle: msg.pending ? 'italic' : 'normal',
        }}
      >
        {msg.text}
      </div>
    </div>
  );
}

function stringifyResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    for (const key of ['finalText', 'reportMd', 'text', 'output']) {
      const v = r[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
