import { create } from 'zustand'
import type { PromptBlock, PromptMaterialRef, PromptSpecV2 } from '@agent2live/contracts'
import type { PromptEditSource } from '@agent2live/contracts'
import {
  makePromptBlock,
  makeRequirement,
  removeBlock as removeBlockHelper,
  removeRequirement as removeRequirementHelper,
  replaceMaterialRefs,
  toCoreSpec
} from './prompt-helpers'

export interface WorkbenchSnapshot {
  draftId: string | null
  revision: number | null
  rowVersion: number | null
  draft: PromptSpecV2 | null
}

export type WorkbenchPanel = 'versions' | 'ai' | 'generate'

interface WorkbenchStore extends WorkbenchSnapshot {
  dirty: boolean
  savedDraft: PromptSpecV2 | null
  panel: WorkbenchPanel
  selectedVersionId: string | null
  selectedSuggestionId: string | null
  selectedReverseId: string | null
  lastEdited: PromptEditSource | null
  hydrate(snapshot: WorkbenchSnapshot): void
  reset(): void
  setPanel(panel: WorkbenchPanel): void
  selectVersion(versionId: string | null): void
  selectSuggestion(suggestionId: string | null): void
  selectReverse(reverseId: string | null): void
  updateFullPrompt(fullPrompt: string): void
  updateBlock(
    blockId: string,
    patch: {
      label?: string
      text?: string
      category?: string
      strength?: 'must' | 'prefer' | 'avoid'
    }
  ): void
  replaceBlock(block: PromptBlock): void
  updateBlockWeight(blockId: string, weight: number): void
  updateBlockReferences(blockId: string, patch: { requirementRefs?: string[]; materialRefs?: string[] }): void
  updateMaterialRefs(materialRefs: PromptMaterialRef[]): void
  toggleBlockLock(blockId: string): void
  removeBlock(blockId: string): void
  addBlock(negative: boolean): void
  toggleLockAll(): void
  updateRequirement(
    requirementId: string,
    patch: { text?: string; strength?: 'must' | 'prefer' | 'avoid' }
  ): void
  addRequirement(strength: 'must' | 'prefer' | 'avoid'): void
  removeRequirement(requirementId: string): void
  markSaved(draft: PromptSpecV2, rowVersion: number, revision: number): void
  cancelLocalChanges(): void
  setDraftFromServer(draft: PromptSpecV2): void
  applyServerDraft(snapshot: WorkbenchSnapshot): void
}

const EMPTY: WorkbenchSnapshot = {
  draftId: null,
  revision: null,
  rowVersion: null,
  draft: null
}

function requireDraft(state: WorkbenchStore): PromptSpecV2 {
  if (!state.draft) throw new Error('prompt draft is not loaded')
  return state.draft
}

function findBlock(spec: PromptSpecV2, blockId: string) {
  return [...spec.blocks, ...spec.negativeBlocks].find((block) => block.id === blockId) ?? null
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  ...EMPTY,
  dirty: false,
  savedDraft: null,
  panel: 'versions',
  selectedVersionId: null,
  selectedSuggestionId: null,
  selectedReverseId: null,
  lastEdited: null,

  hydrate(snapshot) {
    const current = get()
    if (current.dirty && snapshot.draftId !== null && snapshot.draftId === current.draftId) return
    const normalized = snapshot.draft ? toCoreSpec(snapshot.draft) : null
    set({
      draftId: snapshot.draftId,
      revision: snapshot.revision,
      rowVersion: snapshot.rowVersion,
      draft: normalized ? structuredClone(normalized) : null,
      savedDraft: normalized,
      dirty: false,
      lastEdited: null
    })
  },

  reset() {
    set({
      ...EMPTY,
      dirty: false,
      savedDraft: null,
      panel: 'versions',
      selectedVersionId: null,
      selectedSuggestionId: null,
      selectedReverseId: null,
      lastEdited: null
    })
  },

  setPanel(panel) {
    set({ panel })
  },
  selectVersion(selectedVersionId) {
    set({ selectedVersionId })
  },
  selectSuggestion(selectedSuggestionId) {
    set({ selectedSuggestionId })
  },
  selectReverse(selectedReverseId) {
    set({ selectedReverseId })
  },

  updateFullPrompt(fullPrompt) {
    const current = get()
    const spec = requireDraft(current)
    set({
      draft: { ...spec, fullPrompt },
      dirty: true,
      lastEdited: 'full'
    })
  },

  updateBlock(blockId, patch) {
    const current = get()
    const spec = requireDraft(current)
    const block = findBlock(spec, blockId)
    if (!block) throw new Error('block not found')
    if (spec.lockAll || block.locked) throw new Error('block is locked')
    const next = structuredClone(spec)
    const target = findBlock(next, blockId)!
    if (patch.label !== undefined) target.label = patch.label
    if (patch.text !== undefined) target.text = patch.text
    if (patch.category !== undefined) {
      target.category = patch.category as typeof target.category
    }
    if (patch.strength !== undefined) {
      target.strength = patch.strength
    }
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  replaceBlock(block) {
    const current = get()
    const spec = requireDraft(current)
    if (spec.lockAll) throw new Error('all prompt blocks are locked')
    const next = structuredClone(spec)
    next.blocks = next.blocks.filter((candidate) => candidate.id !== block.id)
    next.negativeBlocks = next.negativeBlocks.filter((candidate) => candidate.id !== block.id)
    if (block.category === 'negative') {
      next.negativeBlocks.push({ ...structuredClone(block), strength: 'avoid' })
    } else {
      next.blocks.push({
        ...structuredClone(block),
        strength: block.strength === 'avoid' ? 'prefer' : block.strength
      })
    }
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  updateBlockWeight(blockId, weight) {
    const current = get()
    const spec = requireDraft(current)
    const block = findBlock(spec, blockId)
    if (!block) throw new Error('block not found')
    if (spec.lockAll || block.locked) throw new Error('block is locked')
    const next = structuredClone(spec)
    findBlock(next, blockId)!.weight = weight
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  updateBlockReferences(blockId, patch) {
    const current = get()
    const spec = requireDraft(current)
    const block = findBlock(spec, blockId)
    if (!block) throw new Error('block not found')
    if (spec.lockAll || block.locked) throw new Error('block is locked')
    const next = structuredClone(spec)
    const target = findBlock(next, blockId)!
    if (patch.requirementRefs !== undefined) {
      target.requirementRefs = [...new Set(patch.requirementRefs)]
    }
    if (patch.materialRefs !== undefined) {
      target.materialRefs = [...new Set(patch.materialRefs)]
    }
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  updateMaterialRefs(materialRefs) {
    const current = get()
    const next = replaceMaterialRefs(requireDraft(current), materialRefs)
    set({ draft: next, dirty: true, lastEdited: 'references' })
  },

  toggleBlockLock(blockId) {
    const current = get()
    const spec = requireDraft(current)
    if (spec.lockAll) throw new Error('all prompt blocks are locked')
    const block = findBlock(spec, blockId)
    if (!block) throw new Error('block not found')
    const next = structuredClone(spec)
    const target = findBlock(next, blockId)!
    target.locked = !target.locked
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  removeBlock(blockId) {
    const current = get()
    const next = removeBlockHelper(requireDraft(current), blockId)
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  addBlock(negative) {
    const current = get()
    const spec = requireDraft(current)
    if (spec.lockAll) throw new Error('all prompt blocks are locked')
    const next = structuredClone(spec)
    const block = makePromptBlock(negative)
    if (negative) next.negativeBlocks.push(block)
    else next.blocks.push(block)
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  toggleLockAll() {
    const spec = requireDraft(get())
    const next = structuredClone(spec)
    next.lockAll = !next.lockAll
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  updateRequirement(requirementId, patch) {
    const current = get()
    const spec = requireDraft(current)
    if (spec.lockAll) throw new Error('all prompt blocks are locked')
    const requirement = spec.sourceRequirements.find((item) => item.id === requirementId)
    if (!requirement) throw new Error('requirement not found')
    const next = structuredClone(spec)
    const target = next.sourceRequirements.find((item) => item.id === requirementId)!
    if (patch.text !== undefined) target.text = patch.text
    if (patch.strength !== undefined) target.strength = patch.strength
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  addRequirement(strength) {
    const spec = requireDraft(get())
    if (spec.lockAll) throw new Error('all prompt blocks are locked')
    const next = structuredClone(spec)
    next.sourceRequirements.push(makeRequirement(strength))
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  removeRequirement(requirementId) {
    const next = removeRequirementHelper(requireDraft(get()), requirementId)
    set({ draft: next, dirty: true, lastEdited: 'blocks' })
  },

  markSaved(draft, rowVersion, revision) {
    const normalized = toCoreSpec(draft)
    set({
      draft: structuredClone(normalized),
      savedDraft: normalized,
      dirty: false,
      lastEdited: null,
      rowVersion,
      revision
    })
  },

  cancelLocalChanges() {
    const current = get()
    if (!current.dirty) return
    set({
      draft: current.savedDraft ? structuredClone(current.savedDraft) : null,
      dirty: false,
      lastEdited: null
    })
  },

  setDraftFromServer(draft) {
    const normalized = toCoreSpec(draft)
    set({
      draft: structuredClone(normalized),
      savedDraft: normalized,
      dirty: false,
      lastEdited: null
    })
  },

  applyServerDraft(snapshot) {
    const normalized = snapshot.draft ? toCoreSpec(snapshot.draft) : null
    set({
      draftId: snapshot.draftId,
      revision: snapshot.revision,
      rowVersion: snapshot.rowVersion,
      draft: normalized ? structuredClone(normalized) : null,
      savedDraft: normalized,
      dirty: false,
      lastEdited: null
    })
  }
}))
