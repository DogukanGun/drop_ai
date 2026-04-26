import type { FlowDef, RunId, RunStatus } from '@dropai/runtime-core';
import { pool } from './pool.js';

interface FlowRow {
  id: string;
  name: string;
  graph: { nodes: FlowDef['nodes']; edges: FlowDef['edges'] };
}

export async function upsertFlow(flow: FlowDef): Promise<void> {
  await pool.query(
    `INSERT INTO flows (id, name, graph)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, graph = EXCLUDED.graph, updated_at = NOW()`,
    [flow.id, flow.name, JSON.stringify({ nodes: flow.nodes, edges: flow.edges })],
  );
}

export async function getFlow(id: string): Promise<FlowDef | null> {
  const { rows } = await pool.query<FlowRow>(`SELECT id, name, graph FROM flows WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, nodes: row.graph.nodes, edges: row.graph.edges };
}

export async function listFlows(): Promise<Array<{ id: string; name: string }>> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM flows ORDER BY updated_at DESC LIMIT 100`,
  );
  return rows;
}

export async function deleteFlow(id: string): Promise<void> {
  await pool.query(`DELETE FROM flows WHERE id = $1`, [id]);
}

export async function createRun(runId: RunId, flowId: string): Promise<void> {
  await pool.query(
    `INSERT INTO runs (id, flow_id, status) VALUES ($1, $2, 'queued')`,
    [runId, flowId],
  );
}

export async function setRunStatus(runId: RunId, status: RunStatus, error?: string): Promise<void> {
  const finishedAt =
    status === 'succeeded' || status === 'failed' || status === 'cancelled' ? 'NOW()' : 'NULL';
  await pool.query(
    `UPDATE runs SET status = $1, finished_at = ${finishedAt}, error = $2 WHERE id = $3`,
    [status, error ?? null, runId],
  );
}
