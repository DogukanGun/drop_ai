import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';
import jwt from '@fastify/jwt';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import type { FlowDef } from '@dropai/runtime-core';
import { config } from './config.js';
import { createRun, getFlow, listFlows, upsertFlow, deleteFlow } from './db/flows.js';
import { createUser, findUserByEmail } from './db/users.js';
import { startRun } from './runtime/executor.js';
import { eventBus } from './runtime/eventBus.js';
import { nodeRegistry } from './nodes/loader.js';
import { listMemory } from './runtime/memory.js';

interface JwtPayload {
  userId: string;
  email: string;
}

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);
  await app.register(jwt, { secret: config.jwtSecret });

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

  async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  }

  function currentUser(req: FastifyRequest): JwtPayload {
    return req.user as JwtPayload;
  }

  // ── Public routes ──────────────────────────────────────────────────────────

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/nodes', async () => nodeRegistry.list());
  app.post('/api/plugins/reload', async () => {
    await nodeRegistry.load();
    return { count: nodeRegistry.list().length };
  });

  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/register',
    async (req, reply) => {
      const { email, password } = req.body ?? {};
      if (!email || !password) {
        return reply.code(400).send({ error: 'email and password are required' });
      }
      if (password.length < 8) {
        return reply.code(400).send({ error: 'password must be at least 8 characters' });
      }
      const existing = await findUserByEmail(email);
      if (existing) {
        return reply.code(409).send({ error: 'email already registered' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await createUser(nanoid(12), email, passwordHash);
      const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '7d' });
      return { token, user: { id: user.id, email: user.email } };
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const { email, password } = req.body ?? {};
      if (!email || !password) {
        return reply.code(400).send({ error: 'email and password are required' });
      }
      const user = await findUserByEmail(email);
      if (!user) {
        return reply.code(401).send({ error: 'Invalid email or password' });
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid email or password' });
      }
      const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '7d' });
      return { token, user: { id: user.id, email: user.email } };
    },
  );

  // ── Protected routes ───────────────────────────────────────────────────────

  app.get('/api/flows', { preHandler: authenticate }, async req => {
    const { userId } = currentUser(req);
    return listFlows(userId);
  });

  app.get<{ Params: { id: string } }>(
    '/api/flows/:id',
    { preHandler: authenticate },
    async (req, reply) => {
      const { userId } = currentUser(req);
      const flow = await getFlow(req.params.id, userId);
      if (!flow) return reply.code(404).send({ error: 'not found' });
      return flow;
    },
  );

  app.post<{ Body: FlowDef }>(
    '/api/flows',
    { preHandler: authenticate },
    async req => {
      const { userId } = currentUser(req);
      const id = req.body.id || nanoid(10);
      const flow: FlowDef = { ...req.body, id, name: req.body.name || 'Untitled' };
      await upsertFlow(flow, userId);
      return { id };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/flows/:id',
    { preHandler: authenticate },
    async req => {
      const { userId } = currentUser(req);
      await deleteFlow(req.params.id, userId);
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/flows/:id/memory',
    { preHandler: authenticate },
    async req => {
      return { triples: listMemory(req.params.id) };
    },
  );

  app.post<{ Params: { id: string }; Body?: { input?: unknown } }>(
    '/api/flows/:id/runs',
    { preHandler: authenticate },
    async (req, reply) => {
      const { userId } = currentUser(req);
      const flow = await getFlow(req.params.id, userId);
      if (!flow) return reply.code(404).send({ error: 'not found' });
      const runId = nanoid(12);
      await createRun(runId, flow.id);
      const input = req.body?.input;
      void startRun(flow, runId, { input });
      return { runId };
    },
  );

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
