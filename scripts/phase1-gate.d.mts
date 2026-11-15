export const PROMPT_WORKBENCH_PAGES: readonly [
  'created-confirmation',
  'character-just-created',
  'overview',
  'new-character-empty',
  'new-character-full',
  'reference-editor',
  'reference-hover',
  'workbench-references',
  'workbench-candidates',
  'character-card'
]

export const PROVIDER_PAGES: readonly ['providers']

export const UI_EVIDENCE_PAGES: readonly [...PROMPT_WORKBENCH_PAGES, ...PROVIDER_PAGES]
