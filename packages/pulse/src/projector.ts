import type { AgentEvent } from '@dropai/runtime-core';

/**
 * Pulse — event-driven canvas visualizer.
 *
 * A grid of tiles, one per registered node. Each tile pulses when its node
 * emits an AgentEvent: `start` lights it up, `progress` adds energy, `error`
 * flashes red, `end` fades it. Energy decays per frame so the canvas reflects
 * activity rather than absolute state.
 *
 * The public surface (registerNode, syncNodes, ingest, start, stop) is shaped
 * so richer renderers (3D scenes, waveforms, heatmaps) can replace the tile
 * grid later without changing callers.
 */

export interface NodeRegistration {
  id: string;
  label: string;
  color: string;
}

export interface ProjectorOptions {
  canvas: HTMLCanvasElement;
}

interface TileState {
  reg: NodeRegistration;
  /** 0..1 — visual intensity, decays each frame. */
  energy: number;
  /** Tints the tile red on error. */
  errorFlashUntil: number;
  /** When the node finished, faded out. */
  ended: boolean;
  /** Last event seen (for label / payload preview). */
  lastEvent?: AgentEvent;
}

export class Projector {
  private ctx: CanvasRenderingContext2D;
  private tiles = new Map<string, TileState>();
  private rafId: number | null = null;
  private lastFrame = 0;

  constructor(private options: ProjectorOptions) {
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
  }

  registerNode(reg: NodeRegistration): void {
    if (!this.tiles.has(reg.id)) {
      this.tiles.set(reg.id, { reg, energy: 0, errorFlashUntil: 0, ended: false });
    } else {
      const state = this.tiles.get(reg.id)!;
      state.reg = reg;
    }
  }

  /** Drop tiles for nodes that no longer exist in the editor. */
  syncNodes(regs: NodeRegistration[]): void {
    const ids = new Set(regs.map(r => r.id));
    for (const id of [...this.tiles.keys()]) {
      if (!ids.has(id)) this.tiles.delete(id);
    }
    for (const r of regs) this.registerNode(r);
  }

  reset(): void {
    for (const tile of this.tiles.values()) {
      tile.energy = 0;
      tile.errorFlashUntil = 0;
      tile.ended = false;
      tile.lastEvent = undefined;
    }
  }

  ingest(event: AgentEvent): void {
    if (event.channel === 'meta') return;
    let tile = this.tiles.get(event.nodeId);
    if (!tile) {
      // Unknown node — register a placeholder so we still render activity.
      tile = { reg: { id: event.nodeId, label: event.nodeId, color: '#6aa6ff' }, energy: 0, errorFlashUntil: 0, ended: false };
      this.tiles.set(event.nodeId, tile);
    }
    tile.lastEvent = event;
    switch (event.kind) {
      case 'start':
        tile.energy = 1;
        tile.ended = false;
        break;
      case 'progress':
        tile.energy = Math.min(1, tile.energy + 0.6);
        break;
      case 'output':
        tile.energy = 1;
        break;
      case 'error':
        tile.errorFlashUntil = performance.now() + 800;
        break;
      case 'end':
        tile.energy = Math.max(tile.energy, 0.4);
        tile.ended = true;
        break;
    }
  }

  start(): void {
    if (this.rafId !== null) return;
    const loop = (now: number) => {
      const dt = this.lastFrame === 0 ? 16 : Math.min(64, now - this.lastFrame);
      this.lastFrame = now;
      this.tick(dt);
      this.draw(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const c = this.options.canvas;
    c.width = Math.max(1, Math.floor(cssWidth * dpr));
    c.height = Math.max(1, Math.floor(cssHeight * dpr));
    c.style.width = `${cssWidth}px`;
    c.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private tick(dt: number): void {
    const decay = Math.exp(-dt / 600); // half-life ~415ms
    for (const tile of this.tiles.values()) {
      tile.energy *= decay;
      if (tile.energy < 0.001) tile.energy = 0;
    }
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    const cssW = this.options.canvas.clientWidth;
    const cssH = this.options.canvas.clientHeight;
    ctx.clearRect(0, 0, cssW, cssH);
    drawBackdrop(ctx, cssW, cssH, now);

    const tiles = [...this.tiles.values()];
    if (tiles.length === 0) return;

    const cols = Math.min(tiles.length, Math.max(2, Math.floor(cssW / 220)));
    const rows = Math.ceil(tiles.length / cols);
    const pad = 10;
    const tileW = (cssW - pad * (cols + 1)) / cols;
    const tileH = (cssH - pad * (rows + 1)) / rows;

    tiles.forEach((tile, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + col * (tileW + pad);
      const y = pad + row * (tileH + pad);
      drawTile(ctx, tile, x, y, tileW, tileH, now);
    });
  }
}

function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#06080c');
  g.addColorStop(1, '#0b0f17');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // subtle moving scanlines
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#6aa6ff';
  ctx.lineWidth = 1;
  for (let y = (now / 40) % 8; y < h; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: TileState,
  x: number,
  y: number,
  w: number,
  h: number,
  now: number,
): void {
  const errorFlash = tile.errorFlashUntil > now ? (tile.errorFlashUntil - now) / 800 : 0;
  const baseColor = errorFlash > 0 ? '#ff6f6f' : tile.reg.color;
  const energy = Math.max(tile.energy, errorFlash * 0.8);

  // glow
  if (energy > 0.05) {
    const grd = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.7);
    grd.addColorStop(0, withAlpha(baseColor, 0.45 * energy));
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(x - 8, y - 8, w + 16, h + 16);
  }

  // tile body
  ctx.fillStyle = '#141923';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  // border
  ctx.strokeStyle = withAlpha(baseColor, 0.25 + 0.65 * energy);
  ctx.lineWidth = 1 + energy * 1.5;
  roundRect(ctx, x, y, w, h, 8);
  ctx.stroke();

  // pulse waveform
  if (energy > 0.02) {
    ctx.strokeStyle = withAlpha(baseColor, 0.7 * energy);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const cy = y + h - 18;
    const amp = (h * 0.18) * energy;
    const speed = now / 280;
    for (let i = 0; i <= w - 24; i += 2) {
      const phase = (i / Math.max(40, w)) * Math.PI * 4 + speed;
      const py = cy + Math.sin(phase) * amp;
      if (i === 0) ctx.moveTo(x + 12 + i, py);
      else ctx.lineTo(x + 12 + i, py);
    }
    ctx.stroke();
  }

  // text
  ctx.fillStyle = withAlpha(baseColor, 0.95);
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(tile.reg.label, x + 12, y + 10);

  ctx.fillStyle = 'rgba(216,221,231,0.65)';
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  const sub = tile.lastEvent
    ? `${tile.lastEvent.kind}${tile.ended ? ' · ended' : ''}`
    : 'idle';
  ctx.fillText(sub, x + 12, y + 28);

  if (tile.lastEvent?.payload !== undefined) {
    const preview = String(JSON.stringify(tile.lastEvent.payload)).slice(0, 80);
    ctx.fillStyle = 'rgba(216,221,231,0.45)';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(preview, x + 12, y + 46);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function withAlpha(hex: string, alpha: number): string {
  // accepts #rgb, #rrggbb
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h.padEnd(6, '0');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
