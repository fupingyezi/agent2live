import { ulid } from 'ulid'

export const ID_PREFIXES = {
  character: 'chr',
  artProject: 'artp',
  projectFork: 'frk',
  asset: 'ast',
  assetProvenance: 'aprov',
  assetLink: 'alink',
  promptInput: 'pin',
  promptDraft: 'pd',
  promptVersion: 'pv',
  promptSuggestion: 'psg',
  characterBrief: 'cbv',
  promptReverse: 'prv',
  generation: 'gen',
  generationCandidate: 'cand',
  artVersion: 'av',
  live2dProject: 'l2d',
  job: 'job',
  jobEvent: 'jev',
  providerConnection: 'conn',
  providerInvocation: 'pinv',
  backup: 'bkp',
  secretRef: 'sec',
  request: 'req',
  trace: 'trc'
} as const

export type EntityKind = keyof typeof ID_PREFIXES

const ULID_PART = /^[0-9A-HJKMNP-TV-Z]{26}$/

export function newId(kind: EntityKind): string {
  return `${ID_PREFIXES[kind]}_${ulid()}`
}

export function isId(kind: EntityKind, value: string): boolean {
  const prefix = `${ID_PREFIXES[kind]}_`
  return value.startsWith(prefix) && ULID_PART.test(value.slice(prefix.length))
}
