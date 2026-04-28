import type { FlowDef, RunId, RunStatus } from '@dropai/runtime-core';
import { pool } from './pool.js';

interface FlowRow {
  id: string;
  name: string;
  graph: { nodes: FlowDef['nodes']; edges: FlowDef['edges']; settings?: FlowDef['settings'] };
}

export async function upsertFlow(flow: FlowDef, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO flows (id, name, graph, user_id)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, graph = EXCLUDED.graph, updated_at = NOW()`,
    [
      flow.id,
      flow.name,
      JSON.stringify({ nodes: flow.nodes, edges: flow.edges, settings: flow.settings ?? {} }),
      userId,
    ],
  );
}

export async function getFlow(id: string, userId?: string): Promise<FlowDef | null> {
  const query = userId
    ? `SELECT id, name, graph FROM flows WHERE id = $1 AND user_id = $2`
    : `SELECT id, name, graph FROM flows WHERE id = $1`;
  const params = userId ? [id, userId] : [id];
  const { rows } = await pool.query<FlowRow>(query, params);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    nodes: row.graph.nodes,
    edges: row.graph.edges,
    settings: row.graph.settings ?? {},
  };
}

export async function listFlows(userId: string): Promise<Array<{ id: string; name: string }>> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM flows WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
    [userId],
  );
  return rows;
}

export async function deleteFlow(id: string, userId: string): Promise<void> {
  await pool.query(`DELETE FROM flows WHERE id = $1 AND user_id = $2`, [id, userId]);
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
