/**
 * Public SDK for plugin authors.
 *
 * A node plugin is an npm package whose package.json declares a `dropai.node`
 * manifest and ships a runtime entry. Optionally it also ships a frontend
 * bundle exporting a NodeUI describing the inspector form.
 *
 * Example package.json:
 *
 *   {
 *     "name": "node-foo",
 *     "dropai": {
 *       "node": {
 *         "type": "foo",
 *         "category": "agents",
 *         "label": "Foo",
 *         "runner": "node",
 *         "runtime": "./dist/runtime.js",
 *         "frontend": "./dist/frontend.js",
 *         "inputs": 1,
 *         "outputs": 1
 *       }
 *     }
 *   }
 */

export type {
  AgentEvent,
  EventKind,
  FlowDef,
  FlowEdge,
  FlowNode,
  Message,
  NodeManifest,
  NodeRuntimeModule,
  RunCtx,
  RunnerKind,
} from '@dropai/runtime-core';

import type { ComponentType } from 'react';

export interface NodeUIProps<TConfig> {
  config: TConfig;
  onChange: (next: TConfig) => void;
}

export interface NodeUI<TConfig = Record<string, unknown>> {
  defaults: TConfig;
  Form: ComponentType<NodeUIProps<TConfig>>;
  label: (cfg: TConfig) => string;
  color?: string;
  icon?: string;
}

export function defineNodeUI<TConfig>(ui: NodeUI<TConfig>): NodeUI<TConfig> {
  return ui;
}
