import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { FlowDef } from '@dropai/runtime-core';
import { config } from './config.js';
import { createRun, getFlow, listFlows, upsertFlow, deleteFlow } from './db/flows.js';
import { startRun } from './runtime/executor.js';
import { eventBus } from './runtime/eventBus.js';
import { nodeRegistry } from './nodes/loader.js';

async function main() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  const artifactsRoot = resolve(config.artifactsDir);
  mkdirSync(artifactsRoot, { recursive: true });
  await app.register(staticPlugin, {
    root: artifactsRoot,
    prefix: '/api/artifacts/',
    decorateReply: false,
  });

  await nodeRegistry.load();
  app.log.info(
    { plugins: nodeRegistry.pluginsList().map(p => `${p.name}@${p.version}`) },
    `loaded ${nodeRegistry.list().length} node types`,
  );

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/nodes', async () => nodeRegistry.list());

  app.post('/api/plugins/reload', async () => {
    await nodeRegistry.load();
    return { count: nodeRegistry.list().length };
  });

  app.get('/api/flows', async () => listFlows());

  app.get<{ Params: { id: string } }>('/api/flows/:id', async (req, reply) => {
    const flow = await getFlow(req.params.id);
    if (!flow) return reply.code(404).send({ error: 'not found' });
    return flow;
  });

  app.post<{ Body: FlowDef }>('/api/flows', async req => {
    const id = req.body.id || nanoid(10);
    const flow: FlowDef = { ...req.body, id, name: req.body.name || 'Untitled' };
    await upsertFlow(flow);
    return { id };
  });

  app.delete<{ Params: { id: string } }>('/api/flows/:id', async req => {
    await deleteFlow(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/flows/:id/runs', async (req, reply) => {
    const flow = await getFlow(req.params.id);
    if (!flow) return reply.code(404).send({ error: 'not found' });
    const runId = nanoid(12);
    await createRun(runId, flow.id);
    // fire and forget; caller subscribes via WS to follow progress
    void startRun(flow, runId);
    return { runId };
  });

  app.get('/ws/runs/:id/events', { websocket: true }, (socket, req) => {
    const runId = (req.params as { id: string }).id;
    const unsubscribe = eventBus.subscribe(runId, event => {
      socket.send(JSON.stringify(event));
    });
    socket.on('close', unsubscribe);
  });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`orchestrator listening on http://${config.host}:${config.port}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
