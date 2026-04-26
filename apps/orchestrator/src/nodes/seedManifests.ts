import type { NodeManifest } from '@dropai/runtime-core';

/**
 * Hardcoded for editor v0. Step 10 replaces this with a plugin loader that
 * scans /plugins/* for `dropai.node` manifests in package.json files.
 *
 * Keep this list in sync with apps/web/src/seedNodes.ts until then.
 */
export const SEED_NODE_MANIFESTS: NodeManifest[] = [
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
];
