# Prompt Workbench Unified Editor Design

## Intent

The prompt workbench must treat the coherent full prompt and its granular prompt
blocks as two synchronized representations of one PromptSpec version. They are
not separate documents, drafts, or version histories.

The selected version determines the complete editing surface: its full prompt,
its granular blocks, its reference set, its artwork, and its generation history.

## Goals

- Keep `PromptSpecV2` as the single persisted source for a prompt version.
- Store a coherent natural-language `fullPrompt` in that same PromptSpec.
- Keep existing `blocks` and `negativeBlocks` as the structured representation.
- Synchronize full prompt edits into granular blocks through DeepSeek.
- Synchronize granular block edits into a coherent full prompt through DeepSeek.
- Preserve block IDs, locks, provenance, weights, requirements, and material
  references across synchronization. Locked blocks are never silently replaced.
- Use the right inspector for prompt editing, saving, AI optimization, and
  generation entry.
- Use the left version area to select the version whose prompts, references,
  artwork, and generation state are shown together.
- Keep generation settings, candidate acceptance, and other transient decisions
  in modal dialogs rather than persistent cards in the canvas.
- Support both initial inputs: image reversal and text brief optimization.

## Non-Goals

- Do not create a second full-prompt entity, table, version counter, or history.
- Do not replace `PromptSpecV2` blocks with a plain string.
- Do not place prompt editors, generation settings, or settings forms below the
  main 1440x900 workbench frame.
- Do not implement pixel editing, cropping, retouching, or PSD workflows in this
  change.
- Do not auto-apply an AI synchronization that contradicts a locked block.

## Data Model

`PromptSpecV2` gains one top-level field:

```ts
fullPrompt: string
```

The field is part of the same PromptSpec and therefore participates in canonical
content hashing, draft revisions, prompt versions, reverse results, suggestions,
forks, generation provenance, and backups.

`fullPrompt` is the coherent, user-editable prose representation. `blocks` and
`negativeBlocks` remain the structured representation used for locking,
requirements, evidence, weights, references, and provider compilation.

Existing persisted PromptSpecs may omit `fullPrompt`. Normalization fills missing
values from the existing blocks without a database migration.

## Synchronization Contract

The editor tracks which representation the user edited last:

```ts
type PromptEditSource = 'full' | 'blocks'
```

Before save, only the last edited representation is authoritative:

- `full`: save the user's exact fullPrompt text and ask DeepSeek to materialize
  matching granular blocks.
- `blocks`: save the exact block edits and ask DeepSeek to produce the coherent
  fullPrompt text.

The synchronized pair is then written atomically as one PromptDraft revision and
later one PromptVersion. The client does not persist either side independently.

### Full to blocks

DeepSeek returns candidate granular blocks derived from the edited fullPrompt.
Existing locked blocks remain unchanged. Existing unlocked blocks retain their
IDs and metadata when their meaning is still present. New content receives new
block IDs. Removed content is removed only from unlocked blocks.

If the fullPrompt contradicts a locked block, synchronization does not silently
alter the fullPrompt or the locked block. The right inspector shows the
conflict and requires the user to revise the fullPrompt or explicitly unlock the
block before saving.

### Blocks to full

DeepSeek receives the complete granular spec, character brief, and locked
constraints, then returns one coherent fullPrompt. This output must not introduce
facts absent from the blocks or character brief. The exact block edits remain
authoritative and are saved together with the generated fullPrompt.

### Save and generate

The right inspector exposes:

- Save draft
- AI optimize
- Generate

Generate is disabled while the current editing session has unsynchronized
changes. Saving performs synchronization first, then persists the pair. The
generation modal always uses a committed PromptVersion, never a partially
synchronized local state.

## Right Inspector

The right `角色描述` inspector contains:

1. The selected version label and linked art state.
2. A multiline `完整提示词` editor.
3. Expandable granular prompt sections using the existing block editor.
4. Lock, category, weight, requirement, and material controls attached to their
   corresponding blocks.
5. Save, AI optimize, and Generate actions anchored at the bottom of the
   inspector.

The inspector scrolls independently. Editing either representation marks the
other as pending synchronization; it does not create a page-level editor below
the canvas.

## Left Version Management

Each left-side node represents an immutable art version and its linked prompt
version:

```text
ArtVersion v3
  artwork thumbnail
  linked PromptVersion v5
  active / historical / seeded
```

Selecting a node switches all of the following together:

- fullPrompt and granular blocks from the linked PromptVersion;
- reference set and artwork from the ArtVersion;
- selected-version actions such as activate, rollback, fork, and reference
  revision.

The current unsaved draft is shown as a separate draft node at the top. It is not
an immutable version until committed. ArtVersion provenance remains governed by
the existing technical design.

## Center Canvas and Modals

The center canvas only displays the selected version's visual content:

- reference images;
- artwork;
- candidate comparison when explicitly requested;
- read-only task status.

It does not contain persistent prompt forms or generation settings.

The following interactions use modals:

- generation model, size, count, seed, and task confirmation;
- candidate acceptance;
- manual artwork upload;
- version activation or rollback confirmation;
- fork source and branch metadata;
- locked-block synchronization conflicts.

## Character Creation

Character creation produces one initial PromptSpec pair.

### Image input

The existing Zhipu reference-image reverse pipeline produces candidate blocks.
The same synchronization pipeline generates the coherent fullPrompt.

### Text input

Character title, summary, and supplementary notes are sent to DeepSeek to create
an initial fullPrompt and matching granular blocks. The character brief remains
authoritative and is projected into locked blocks.

### Both inputs

The text brief creates the base PromptSpec first. Image reverse then runs against
that base, preserves locked brief blocks, and adds visual details supported by
the references. After merge, the complete prompt pair is synchronized and shown
on the creation confirmation page before entering the workbench.

If no text optimizer or vision provider is available, creation still succeeds:

- the submitted brief remains a valid draft;
- the workbench explains which optimization was skipped;
- the user can retry from the right inspector.

## Failure Handling

- DeepSeek synchronization failure leaves the last saved draft unchanged.
- A stale draft revision returns the existing conflict response and requires a
  refresh.
- A malformed AI response leaves both representations unchanged and reports the
  provider/schema failure.
- A locked-block conflict is actionable and visible in the inspector.
- Switching versions with unsaved edits prompts for save, discard, or cancel.

## Approaches Considered

### One PromptSpec with synchronized representations

Selected. It preserves one revision/version/hash and uses the existing block
domain model for locks and references.

### Separate full-prompt and block entities

Rejected because it creates two version histories and ambiguous generation
authority.

### Granular blocks only, with fullPrompt generated per provider

Rejected because provider compilation changes by model capability and therefore
cannot be the stable, user-editable complete prompt.

## Success Criteria

- A prompt version round-trips as one fullPrompt plus one granular spec.
- Editing either representation synchronizes the other before save.
- Locked blocks are never silently changed.
- Switching left-side versions updates prompts, references, artwork, and actions
  together.
- No prompt editor or generation settings remain below the workbench.
- Text-only and image-based character creation both produce the same unified
  PromptSpec shape.
- Existing PromptSpecs remain readable after normalization.
