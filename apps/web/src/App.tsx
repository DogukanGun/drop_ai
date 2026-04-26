import { useCallback, useEffect, useRef, useState } from 'react';
import { Palette } from './Palette';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { VizPanel } from './VizPanel';
import { useFlow } from './store';
import { fetchNodeManifests, saveFlow, startRun, subscribeToRun } from './api';
import { paletteFromManifests } from './seedNodes';

export function App() {
  const saveLocal = useFlow(s => s.saveLocal);
  const loadLocal = useFlow(s => s.loadLocal);
  const setFlowId = useFlow(s => s.setFlowId);
  const flowId = useFlow(s => s.flowId);
  const flowName = useFlow(s => s.flowName);
  const setFlowName = useFlow(s => s.setFlowName);
  const toFlowDef = useFlow(s => s.toFlowDef);
  const nodeCount = useFlow(s => s.nodes.length);
  const edgeCount = useFlow(s => s.edges.length);
  const clearEvents = useFlow(s => s.clearEvents);
  const pushEvent = useFlow(s => s.pushEvent);
  const setRunId = useFlow(s => s.setRunId);
  const runId = useFlow(s => s.runId);
  const setPalette = useFlow(s => s.setPalette);

  const [status, setStatus] = useState<string>('');
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    loadLocal();
    fetchNodeManifests()
      .then(manifests => setPalette(paletteFromManifests(manifests)))
      .catch(err => setStatus(`palette: ${err instanceof Error ? err.message : err}`));
    return () => unsubRef.current?.();
  }, [loadLocal, setPalette]);

  const onSave = useCallback(async () => {
    saveLocal();
    try {
      const def = toFlowDef();
      const { id } = await saveFlow(def);
      setFlowId(id);
      setStatus(`saved as ${id}`);
    } catch (err) {
      setStatus(`save failed: ${err instanceof Error ? err.message : err}`);
    }
  }, [saveLocal, toFlowDef, setFlowId]);

  const onRun = useCallback(async () => {
    let id = flowId;
    try {
      if (!id || nodeCount === 0) {
        const def = toFlowDef();
        const saved = await saveFlow(def);
        setFlowId(saved.id);
        id = saved.id;
      }
      clearEvents();
      const { runId: newRunId } = await startRun(id!);
      setRunId(newRunId);
      setStatus(`running ${newRunId}`);
      unsubRef.current?.();
      unsubRef.current = subscribeToRun(newRunId, ev => pushEvent(ev));
    } catch (err) {
      setStatus(`run failed: ${err instanceof Error ? err.message : err}`);
    }
  }, [flowId, nodeCount, toFlowDef, setFlowId, clearEvents, setRunId, pushEvent]);

  return (
    <div className="app-shell">
      <div className="topbar">
        <h1>DropAI</h1>
        <input
          value={flowName}
          onChange={e => setFlowName(e.target.value)}
          style={{
            background: 'var(--panel-2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '3px 8px',
            font: 'inherit',
            width: 180,
          }}
        />
        <span style={{ color: 'var(--text-dim)' }}>
          {nodeCount} node{nodeCount === 1 ? '' : 's'} · {edgeCount} edge{edgeCount === 1 ? '' : 's'}
        </span>
        <span style={{ color: 'var(--text-dim)' }}>{status}</span>
        <div className="spacer" />
        <button onClick={onSave}>Save</button>
        <button className="primary" onClick={onRun} disabled={nodeCount === 0}>
          {runId ? 'Run again' : 'Run'}
        </button>
      </div>
      <Palette />
      <Canvas />
      <Inspector />
      <VizPanel />
    </div>
  );
}
