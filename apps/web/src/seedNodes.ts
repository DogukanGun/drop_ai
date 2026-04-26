import type { NodeManifest } from '@dropai/runtime-core';

/**
 * Fallback palette for when the orchestrator is offline. The live palette
 * comes from GET /api/nodes (served by the plugin loader).
 *
 * `configFields` is an editor-only convenience for inspector form rendering.
 * Plugins can ship their own `configSchema` (JSON Schema) which we'll honor
 * later — for now we infer fields from a small heuristic in Inspector.tsx.
 */

export type ConfigField =
  | { kind: 'text'; key: string; label: string; placeholder?: string }
  | { kind: 'textarea'; key: string; label: string; placeholder?: string }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[] };

export interface PaletteEntry extends NodeManifest {
  defaults: Record<string, unknown>;
  configFields: ConfigField[];
}

const FIELD_HINTS: Record<string, ConfigField[]> = {
  input: [
    { kind: 'text', key: 'payload', label: 'Payload', placeholder: 'string or JSON' },
  ],
  maestro: [
    { kind: 'textarea', key: 'task', label: 'Research task', placeholder: 'What should the agent research?' },
    {
      kind: 'select',
      key: 'model',
      label: 'Model',
      options: [
        { value: 'gpt-4o', label: 'gpt-4o' },
        { value: 'claude-opus-4-7', label: 'claude-opus-4-7' },
      ],
    },
  ],
  'browser-use': [
    { kind: 'textarea', key: 'task', label: 'Browser task', placeholder: 'e.g. Find the top story on HN' },
    { kind: 'text', key: 'maxSteps', label: 'Max steps' },
  ],
  'browser-harness': [
    { kind: 'textarea', key: 'code', label: 'Python code', placeholder: 'helpers.* available' },
  ],
  'knowledge-graph': [
    { kind: 'textarea', key: 'text', label: 'Source text', placeholder: 'Paste a document…' },
  ],
  'text-template': [
    { kind: 'textarea', key: 'template', label: 'Template', placeholder: 'Hello {{input}}' },
  ],
};

const DEFAULT_FALLBACKS: Record<string, Record<string, unknown>> = {
  input: { payload: '' },
  maestro: { task: '', model: 'gpt-4o' },
  'browser-use': { task: '', maxSteps: 30 },
  'browser-harness': { code: 'print(page_info())' },
  'knowledge-graph': { text: '' },
  'text-template': { template: '{{input}}' },
};

export function paletteFromManifests(manifests: NodeManifest[]): PaletteEntry[] {
  return manifests.map(m => ({
    ...m,
    defaults: (m.defaults as Record<string, unknown>) ?? DEFAULT_FALLBACKS[m.type] ?? {},
    configFields: FIELD_HINTS[m.type] ?? inferFields(m),
    color: m.color ?? '#6aa6ff',
  }));
}

function inferFields(m: NodeManifest): ConfigField[] {
  // Generic: a single textarea named "config" so users can at least edit.
  return [{ kind: 'textarea', key: 'value', label: 'Value', placeholder: m.description ?? '' }];
}

/** Static fallback used until the manifest fetch resolves. Mirrors the seeds. */
export const FALLBACK_PALETTE: PaletteEntry[] = paletteFromManifests([
  {
    type: 'input',
    category: 'IO',
    label: 'Input',
    description: 'Trigger / seed payload',
    color: '#8b93a4',
    inputs: 0,
    outputs: 1,
    runner: 'node',
    runtime: 'stub:input',
  },
  {
    type: 'maestro',
    category: 'Research',
    label: 'Maestro Research',
    description: 'Multi-agent research → report',
    color: '#b07bff',
    inputs: 1,
    outputs: 1,
    runner: 'python',
    runtime: 'stub:maestro',
  },
  {
    type: 'browser-use',
    category: 'Browser',
    label: 'Browser Agent',
    description: 'LLM-driven web automation',
    color: '#6aa6ff',
    inputs: 1,
    outputs: 1,
    runner: 'python',
    runtime: 'stub:browser-use',
  },
  {
    type: 'browser-harness',
    category: 'Browser',
    label: 'Browser Harness',
    description: 'Low-level CDP code',
    color: '#5fd49a',
    inputs: 1,
    outputs: 1,
    runner: 'python',
    runtime: 'stub:browser-harness',
  },
  {
    type: 'knowledge-graph',
    category: 'Knowledge',
    label: 'Knowledge Graph',
    description: 'Text → SPO triples → graph',
    color: '#ffb454',
    inputs: 1,
    outputs: 1,
    runner: 'python',
    runtime: 'stub:knowledge-graph',
  },
]);
