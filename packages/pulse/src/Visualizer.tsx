import { useEffect, useRef } from 'react';
import type { AgentEvent } from '@dropai/runtime-core';
import { Projector, type NodeRegistration } from './projector.js';

export interface VisualizerProps {
  /** Live event stream from the orchestrator. New events trigger animations. */
  events: AgentEvent[];
  /** Nodes currently on the canvas (so the viz reserves a tile for each, even pre-run). */
  nodes: NodeRegistration[];
}

/**
 * Headless React wrapper around Projector. Recomputes the registered tile set
 * from `nodes` and feeds new events into Projector.ingest as they arrive.
 */
export function Visualizer({ events, nodes }: VisualizerProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const projectorRef = useRef<Projector | null>(null);
  const seenRef = useRef<number>(0);

  // Init projector + responsive resize
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const projector = new Projector({ canvas });
    projectorRef.current = projector;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      projector.resize(r.width, r.height, dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    projector.start();
    return () => {
      projector.stop();
      ro.disconnect();
      projectorRef.current = null;
    };
  }, []);

  // Sync registered tiles whenever the editor's node set changes
  useEffect(() => {
    projectorRef.current?.syncNodes(nodes);
  }, [nodes]);

  // Feed any newly-arrived events into the projector
  useEffect(() => {
    const projector = projectorRef.current;
    if (!projector) return;
    for (let i = seenRef.current; i < events.length; i++) {
      projector.ingest(events[i]!);
    }
    seenRef.current = events.length;
    if (events.length === 0) {
      projector.reset();
      seenRef.current = 0;
    }
  }, [events]);

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
