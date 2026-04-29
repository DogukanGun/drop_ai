import { useCallback, useEffect, useState } from 'react';
import { Palette } from './Palette';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { VizPanel } from './VizPanel';
import { useFlow, useAuth } from './store';
import { fetchNodeManifests, saveFlow, downloadFlow } from './api';
import { paletteFromManifests } from './seedNodes';
import { LoginPage } from './LoginPage';

export function App() {
  const isAuthenticated = useAuth(s => s.isAuthenticated);
  const user = useAuth(s => s.user);
  const signOut = useAuth(s => s.signOut);

  if (!isAuthenticated) return <LoginPage />;

  return <Canvas_ user={user?.email} onSignOut={signOut} />;
}

function Canvas_({ user, onSignOut }: { user?: string; onSignOut: () => void }) {
  const saveLocal = useFlow(s => s.saveLocal);
  const loadLocal = useFlow(s => s.loadLocal);
  const setFlowId = useFlow(s => s.setFlowId);
  const flowName = useFlow(s => s.flowName);
  const setFlowName = useFlow(s => s.setFlowName);
  const toFlowDef = useFlow(s => s.toFlowDef);
  const nodeCount = useFlow(s => s.nodes.length);
  const edgeCount = useFlow(s => s.edges.length);
  const setPalette = useFlow(s => s.setPalette);
  const memoryEnabled = useFlow(s => Boolean(s.settings.memoryEnabled));
  const setSettings = useFlow(s => s.setSettings);

  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    loadLocal();
    fetchNodeManifests()
      .then(manifests => setPalette(paletteFromManifests(manifests)))
      .catch(err => setStatus(`palette: ${err instanceof Error ? err.message : err}`));
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

  const onToggleMemory = useCallback(() => {
    setSettings({ memoryEnabled: !memoryEnabled });
    saveLocal();
  }, [memoryEnabled, setSettings, saveLocal]);

  const onDownload = useCallback(async () => {
    setStatus('packaging…');
    try {
      const def = toFlowDef();
      const { id } = await saveFlow(def);
      setFlowId(id);
      await downloadFlow(id, def.name);
      setStatus('downloaded');
    } catch (err) {
      setStatus(`download failed: ${err instanceof Error ? err.message : err}`);
    }
  }, [toFlowDef, setFlowId]);

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
        <button
          onClick={onToggleMemory}
          title="Persistent agent memory across chat turns (knowledge graph)"
          style={{
            background: memoryEnabled ? 'var(--accent-2)' : 'var(--panel-2)',
            color: memoryEnabled ? '#0c0814' : 'var(--text-dim)',
            borderColor: memoryEnabled ? 'var(--accent-2)' : 'var(--border)',
            fontWeight: memoryEnabled ? 600 : 400,
          }}
        >
          Memory: {memoryEnabled ? 'on' : 'off'}
        </button>
        <button onClick={onSave}>Save</button>
        <button
          onClick={onDownload}
          title="Download a standalone, runnable copy of this flow"
        >
          Download
        </button>
        {user && (
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{user}</span>
        )}
        <button
          onClick={onSignOut}
          style={{ background: 'var(--panel-2)', color: 'var(--text-dim)', borderColor: 'var(--border)' }}
        >
          Sign out
        </button>
      </div>
      <Palette />
      <Canvas />
      <Inspector />
      <VizPanel />
    </div>
  );
}
