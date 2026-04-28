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
  | { kind: 'password'; key: string; label: string; placeholder?: string }
  | { kind: 'textarea'; key: string; label: string; placeholder?: string }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: 'nodeMultiSelect'; key: string; label: string; help?: string };

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
  llm: [
    {
      kind: 'password',
      key: 'dropaiToken',
      label: 'DropAI Token (optional — overrides env API key)',
      placeholder: 'Paste your purchased DropAI token, or leave blank to use OPENAI_API_KEY',
    },
    {
      kind: 'select',
      key: 'model',
      label: 'Model',
      options: [
        { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
        { value: 'gpt-4o', label: 'gpt-4o' },
        { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
        { value: 'o3-mini', label: 'o3-mini' },
      ],
    },
    {
      kind: 'textarea',
      key: 'systemPrompt',
      label: 'System prompt',
      placeholder: 'You are a helpful assistant.',
    },
    {
      kind: 'textarea',
      key: 'userPromptTemplate',
      label: 'User prompt template ({{input}} = upstream / chat message)',
      placeholder: '{{input}}',
    },
    { kind: 'text', key: 'temperature', label: 'Temperature' },
    { kind: 'text', key: 'maxTokens', label: 'Max tokens' },
    { kind: 'text', key: 'baseUrl', label: 'Base URL (OpenAI-compatible)' },
  ],
  'llm-agent': [
    {
      kind: 'password',
      key: 'dropaiToken',
      label: 'DropAI Token (optional — overrides env API key)',
      placeholder: 'Paste your purchased DropAI token, or leave blank to use OPENAI_API_KEY',
    },
    {
      kind: 'select',
      key: 'model',
      label: 'Model',
      options: [
        { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
        { value: 'gpt-4o', label: 'gpt-4o' },
        { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
      ],
    },
    {
      kind: 'textarea',
      key: 'systemPrompt',
      label: 'System prompt',
      placeholder: 'You are a helpful agent.',
    },
    {
      kind: 'nodeMultiSelect',
      key: 'tools',
      label: 'Tools',
      help: 'Pick which canvas nodes the agent can call. Tool nodes are skipped from the linear run order.',
    },
    { kind: 'text', key: 'maxIterations', label: 'Max iterations' },
    { kind: 'text', key: 'temperature', label: 'Temperature' },
  ],
  'llm-claude': [
    {
      kind: 'password',
      key: 'dropaiToken',
      label: 'DropAI Token',
      placeholder: 'Paste your purchased DropAI token here',
    },
    {
      kind: 'select',
      key: 'model',
      label: 'Model',
      options: [
        { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
        { value: 'claude-opus-4-7', label: 'claude-opus-4-7' },
        { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5' },
      ],
    },
    {
      kind: 'textarea',
      key: 'systemPrompt',
      label: 'System prompt',
      placeholder: 'You are a helpful assistant.',
    },
    {
      kind: 'textarea',
      key: 'userPromptTemplate',
      label: 'User prompt template ({{input}} = upstream / chat message)',
      placeholder: '{{input}}',
    },
    { kind: 'text', key: 'temperature', label: 'Temperature' },
    { kind: 'text', key: 'maxTokens', label: 'Max tokens' },
  ],
  'llm-agent-claude': [
    {
      kind: 'password',
      key: 'dropaiToken',
      label: 'DropAI Token',
      placeholder: 'Paste your purchased DropAI token here',
    },
    {
      kind: 'select',
      key: 'model',
      label: 'Model',
      options: [
        { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
        { value: 'claude-opus-4-7', label: 'claude-opus-4-7' },
        { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5' },
      ],
    },
    {
      kind: 'textarea',
      key: 'systemPrompt',
      label: 'System prompt',
      placeholder: 'You are a helpful agent.',
    },
    {
      kind: 'nodeMultiSelect',
      key: 'tools',
      label: 'Tools',
      help: 'Pick which canvas nodes the agent can call. Tool nodes are skipped from the linear run order.',
    },
    { kind: 'text', key: 'maxIterations', label: 'Max iterations' },
    { kind: 'text', key: 'temperature', label: 'Temperature' },
    { kind: 'text', key: 'maxTokens', label: 'Max tokens' },
  ],
  'llm-qwen': [
    {
      kind: 'password',
      key: 'dropaiToken',
      label: 'DropAI Token',
      placeholder: 'Paste your purchased DropAI token here',
    },
    {
      kind: 'select',
      key: 'model',
      label: 'Model',
      options: [
        { value: 'qwen2.5-72b-instruct', label: 'qwen2.5-72b-instruct' },
        { value: 'qwen2.5-32b-instruct', label: 'qwen2.5-32b-instruct' },
        { value: 'qwen3-235b-a22b', label: 'qwen3-235b-a22b' },
      ],
    },
    {
      kind: 'textarea',
      key: 'systemPrompt',
      label: 'System prompt',
      placeholder: 'You are a helpful assistant.',
    },
    {
      kind: 'textarea',
      key: 'userPromptTemplate',
      label: 'User prompt template ({{input}} = upstream / chat message)',
      placeholder: '{{input}}',
    },
    { kind: 'text', key: 'temperature', label: 'Temperature' },
    { kind: 'text', key: 'maxTokens', label: 'Max tokens' },
  ],
  'tool-fetch': [{ kind: 'text', key: 'url', label: 'Default URL (optional)' }],
  'tool-calculator': [{ kind: 'text', key: 'expression', label: 'Default expression (optional)' }],
  'tool-web-search': [
    { kind: 'text', key: 'query', label: 'Default query (optional)' },
    { kind: 'text', key: 'maxResults', label: 'Max results' },
  ],

  // ── Documents ──────────────────────────────────────────────────────────────
  'tool-pdf-signer': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'documentUrl', label: 'Document URL' },
    { kind: 'text', key: 'signatureImageUrl', label: 'Signature Image URL' },
  ],
  'tool-signforge': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'signerEmail', label: 'Signer Email' },
    { kind: 'text', key: 'documentTitle', label: 'Document Title' },
    { kind: 'text', key: 'documentUrl', label: 'Document URL' },
  ],
  'tool-pdf-builder': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    {
      kind: 'select',
      key: 'documentType',
      label: 'Document Type',
      options: [
        { value: 'NDA', label: 'NDA' },
        { value: 'Term Sheet', label: 'Term Sheet' },
        { value: 'Whitepaper', label: 'Whitepaper' },
        { value: 'Invoice', label: 'Invoice' },
      ],
    },
  ],
  'tool-nutrient': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    {
      kind: 'select',
      key: 'operation',
      label: 'Operation',
      options: [
        { value: 'ocr', label: 'OCR' },
        { value: 'redact', label: 'Redact PII' },
        { value: 'convert', label: 'Convert to PDF' },
        { value: 'sign', label: 'PAdES Signature' },
      ],
    },
    { kind: 'text', key: 'documentUrl', label: 'Document URL' },
  ],
  'tool-contract-guard': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
  ],

  // ── Research & Data ────────────────────────────────────────────────────────
  'tool-news-ai': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    {
      kind: 'select',
      key: 'region',
      label: 'Region',
      options: [
        { value: 'global', label: 'Global' },
        { value: 'us', label: 'United States' },
        { value: 'eu', label: 'Europe' },
        { value: 'asia', label: 'Asia' },
        { value: 'latam', label: 'Latin America' },
        { value: 'africa', label: 'Africa' },
        { value: 'oceania', label: 'Oceania' },
      ],
    },
    {
      kind: 'select',
      key: 'category',
      label: 'Category',
      options: [
        { value: 'Technology', label: 'Technology' },
        { value: 'Business', label: 'Business' },
        { value: 'Science', label: 'Science' },
        { value: 'Health', label: 'Health' },
        { value: 'Sports', label: 'Sports' },
        { value: 'Entertainment', label: 'Entertainment' },
      ],
    },
    { kind: 'text', key: 'maxResults', label: 'Max results' },
  ],
  'tool-ai-news': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'topic', label: 'Topic filter (optional)' },
    { kind: 'text', key: 'maxArticles', label: 'Max articles' },
  ],
  'tool-patent-ai': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'maxResults', label: 'Max results' },
  ],
  'tool-earth-link': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'dataType', label: 'Data type (e.g. climate, precipitation)' },
  ],
  'tool-ai-scientist': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'domain', label: 'Research domain' },
    { kind: 'text', key: 'maxIterations', label: 'Max iterations' },
  ],

  // ── Communication & Media ──────────────────────────────────────────────────
  'tool-agentic-mail': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'to', label: 'To (email address)' },
    { kind: 'text', key: 'subject', label: 'Subject' },
  ],
  'tool-postiz': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'platforms', label: 'Platforms (comma-separated)' },
    { kind: 'text', key: 'scheduledAt', label: 'Schedule at (ISO datetime, optional)' },
  ],
  'tool-vimax': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'episodeCount', label: 'Episode count' },
    { kind: 'text', key: 'style', label: 'Style (e.g. cinematic, anime)' },
  ],

  // ── IoT & Smart Home ───────────────────────────────────────────────────────
  'tool-matter-mcp': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'deviceId', label: 'Device ID (optional)' },
  ],
  'tool-smart-home': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
  ],

  // ── Finance & Business ─────────────────────────────────────────────────────
  'tool-agent-bank': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    {
      kind: 'select',
      key: 'operation',
      label: 'Operation',
      options: [
        { value: 'transfer', label: 'Transfer' },
        { value: 'invoice', label: 'Create Invoice' },
        { value: 'balance', label: 'Check Balance' },
        { value: 'invest', label: 'Manage Idle Funds' },
      ],
    },
  ],
  'tool-jobclaw': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'role', label: 'Role / job title' },
    {
      kind: 'select',
      key: 'mode',
      label: 'Mode',
      options: [
        { value: 'seeker', label: 'Job Seeker' },
        { value: 'recruiter', label: 'Recruiter' },
      ],
    },
  ],

  // ── Specialized ────────────────────────────────────────────────────────────
  'tool-clinagent': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'datasetPath', label: 'SAS dataset path' },
  ],
  'tool-medical-mcp': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'patientId', label: 'Patient ID (optional)' },
  ],
  'tool-pentagi': [
    { kind: 'password', key: 'dropaiToken', label: 'DropAI Token', placeholder: 'Paste your purchased DropAI token' },
    { kind: 'text', key: 'scope', label: 'Scope (authorized targets only)' },
    { kind: 'text', key: 'targetUrl', label: 'Target URL' },
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
