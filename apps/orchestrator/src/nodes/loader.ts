import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NodeManifest, NodeRuntimeModule, PluginPackage, RunCtx } from '@dropai/runtime-core';
import { config } from '../config.js';
import { SEED_NODE_MANIFESTS } from './seedManifests.js';
import { STUB_RUNTIMES, type StubRunner } from '../runtime/stubRuntimes.js';
import { callPythonPlugin } from '../runtime/pythonBridge.js';

/**
 * Plugin loader. Scans `pluginsDir` for `package.json` files declaring a
 * `dropai.node` manifest and registers each node type. Mirrors node-red's
 * loader: a node is just an npm package with a manifest, runtime entry, and
 * (optionally) a frontend bundle.
 *
 * Built-in seed nodes always register first; a plugin with the same `type`
 * overrides them.
 */

interface RegisteredNode {
  manifest: NodeManifest;
  source: 'builtin' | 'plugin';
  /** Set for plugins; the runtime entry is import()'d when the node first runs. */
  pluginRoot?: string;
  /** Cached plugin package descriptor (used by the Python bridge). */
  plugin?: PluginPackage;
}

class NodeRegistry {
  private byType = new Map<string, RegisteredNode>();
  private runtimeCache = new Map<string, NodeRuntimeModule | StubRunner>();
  private plugins: PluginPackage[] = [];

  list(): NodeManifest[] {
    return [...this.byType.values()].map(r => r.manifest);
  }

  pluginsList(): PluginPackage[] {
    return [...this.plugins];
  }

  async load(): Promise<void> {
    this.byType.clear();
    this.runtimeCache.clear();
    this.plugins = [];

    for (const m of SEED_NODE_MANIFESTS) {
      this.byType.set(m.type, { manifest: m, source: 'builtin' });
    }

    const pluginsDir = resolve(config.pluginsDir);
    if (!existsSync(pluginsDir)) return;

    const entries = await readdir(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(pluginsDir, entry.name, 'package.json');
      if (!existsSync(pkgPath)) continue;
      try {
        const raw = await readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(raw) as {
          name?: string;
          version?: string;
          dropai?: { node?: NodeManifest };
        };
        const manifest = pkg.dropai?.node;
        if (!manifest) continue;
        const pluginRoot = dirname(pkgPath);
        const pluginPkg: PluginPackage = {
          name: pkg.name ?? entry.name,
          version: pkg.version ?? '0.0.0',
          packageRoot: pluginRoot,
          manifest,
        };
        this.byType.set(manifest.type, { manifest, source: 'plugin', pluginRoot, plugin: pluginPkg });
        this.plugins.push(pluginPkg);
      } catch (err) {
        console.error(`failed to load plugin ${entry.name}:`, err);
      }
    }
  }

  async resolveRuntime(type: string): Promise<StubRunner | null> {
    const cached = this.runtimeCache.get(type);
    if (cached) return cached as StubRunner;

    const reg = this.byType.get(type);
    if (!reg) return null;

    if (reg.source === 'builtin') {
      const stub = STUB_RUNTIMES[type];
      if (stub) {
        this.runtimeCache.set(type, stub);
        return stub;
      }
      return null;
    }

    if (reg.manifest.runner === 'node') {
      const runtimePath = join(reg.pluginRoot!, reg.manifest.runtime);
      const mod = (await import(pathToFileURL(runtimePath).href)) as {
        default?: NodeRuntimeModule;
        run?: NodeRuntimeModule['run'];
      };
      const runtime: NodeRuntimeModule | undefined =
        mod.default ?? (mod.run ? { run: mod.run } : undefined);
      if (!runtime) {
        console.error(`plugin ${type} runtime ${runtimePath} has no default export or run()`);
        return null;
      }
      const wrapped: StubRunner = (ctx, config, msg) =>
        runtime.run(ctx, config as Record<string, unknown>, msg);
      this.runtimeCache.set(type, wrapped);
      return wrapped;
    }

    if (reg.manifest.runner === 'python') {
      const plugin = reg.plugin!;
      const wrapped: StubRunner = (ctx: RunCtx, config, msg) =>
        callPythonPlugin(plugin, ctx, config as Record<string, unknown>, msg);
      this.runtimeCache.set(type, wrapped);
      return wrapped;
    }

    return null;
  }
}

export const nodeRegistry = new NodeRegistry();

/**
 * Adapter so executor.ts can call any registered node uniformly regardless of
 * whether it's a built-in stub, an imported Node plugin, or a Python plugin
 * routed through the python-runner subprocess.
 */
export async function callNodeRuntime(
  type: string,
  ctx: Parameters<StubRunner>[0],
  config: Parameters<StubRunner>[1],
  msg: Parameters<StubRunner>[2],
): Promise<unknown> {
  const runtime = await nodeRegistry.resolveRuntime(type);
  if (!runtime) throw new Error(`No runtime available for type "${type}"`);
  return runtime(ctx, config, msg);
}
