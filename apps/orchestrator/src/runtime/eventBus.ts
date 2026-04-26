import { EventEmitter } from 'node:events';
import type { AgentEvent, RunId } from '@dropai/runtime-core';

/**
 * In-process event bus + per-run replay buffer for editor v0.
 * Subscribers always receive the full history of a run on attach so a slow
 * client doesn't miss the early `start` events. Step 5 swaps the buffer
 * for Redis Streams (XADD/XREAD) which gives the same semantics natively.
 */
class EventBus {
  private emitter = new EventEmitter();
  private buffers = new Map<RunId, AgentEvent[]>();

  publish(event: AgentEvent): void {
    let buf = this.buffers.get(event.flowRunId);
    if (!buf) {
      buf = [];
      this.buffers.set(event.flowRunId, buf);
    }
    buf.push(event);
    this.emitter.emit(channelFor(event.flowRunId), event);
    if (event.channel === 'meta' && (event.payload as { kind?: string })?.kind === 'run-end') {
      // Drop the buffer ~30s after the run ends to bound memory.
      setTimeout(() => this.buffers.delete(event.flowRunId), 30_000).unref();
    }
  }

  subscribe(runId: RunId, listener: (event: AgentEvent) => void): () => void {
    const ch = channelFor(runId);
    for (const past of this.buffers.get(runId) ?? []) listener(past);
    this.emitter.on(ch, listener);
    return () => this.emitter.off(ch, listener);
  }
}

export function channelFor(runId: RunId): string {
  return `flow:${runId}:events`;
}

export const eventBus = new EventBus();
