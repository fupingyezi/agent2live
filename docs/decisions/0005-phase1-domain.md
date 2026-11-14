# ADR 0005: Phase 1 domain model

Status: accepted

## Decisions

1. **A PromptDraft is one row whose revision advances.** Each project has at most
   one `active` row in `prompt_drafts`; saving, accepting a suggestion, and
   applying a reverse result all increment `revision` and `row_version`. Old
   revisions are not kept as separate rows. Immutable history is carried by
   PromptVersion. This avoids maintaining two histories, a draft tree and a
   version tree.
2. **There is no active draft after commit.** Committing a PromptVersion marks
   the draft `committed`. Further editing requires an explicit
   `POST /art-projects/:id/prompt-drafts` that creates a new active draft from
   the active PromptVersion or an empty template. The UI shows "continue
   editing" while viewing a version.
3. **PromptInputSubmission is created only when input changes.** Saving prompt
   blocks alone does not create a submission. Updating the brief, materials, or
   requirements creates a submission in the same transaction and points the
   draft's `input_submission_id` at it. The input snapshot fixes
   `character_brief_version_id` (nullable) and the reference links at that time;
   it is never re-resolved on later reads.
4. **AI reverse/suggestion output lands in dedicated result and suggestion
   tables first.** Model output never writes the draft directly. A reverse
   result must be applied and a suggestion must be accepted. Both pass base-hash,
   locked-block, and version-ownership checks.
5. **Jobs are the only side-effect entry point.** "Ask the AI" only creates a
   job and returns 202; it never calls a model inside the HTTP request. Job
   failure leaves drafts and versions untouched.
6. **`generation_jobs` does not duplicate `status`.** The status in the draft
   data model is derived from `jobs`; Phase 1 triggers/views stay compatible, and
   the service layer returns the derived status via a join.
7. **Added table fields.** `prompt_suggestions` gains `base_kind`,
   `base_draft_id`, `base_draft_revision`, `context_json`, and an exactly-one
   CHECK. `prompt_reverse_results` is a new table. `prompt_versions` and
   `art_versions` gain `version_number`. `prompt_drafts` gains `content_hash`.
   `asset_links` gains `locked`. `jobs` gains `side_effect`,
   `cancel_requested_at`, and `next_attempt_at`. All are backward-compatible
   extensions.
8. **Secret storage.** Phase 1 implements the vault as an Electron
   `safeStorage`-encrypted local file (backed by the macOS Keychain); the sidecar
   requests secrets from Main over the `utilityProcess` parentPort. The database
   stores only `secret_ref`. keytar is not used directly, avoiding a second
   native-module ABI.
9. **Asset content deduplication.** A given `sha256` has exactly one `assets`
   row application-wide; each upload appends `asset_provenance`. Fork reuses the
   asset rows and blobs without copying files.
10. **The API version is fixed at `/api/v1`.** Phase 1 only adds commands under
    `/api/v1/art-projects`; it does not change the Phase 0 health or SSE shapes.
11. **CharacterBriefVersion is an immutable snapshot.**
    `characters.active_brief_version_id` is the only mutable pointer. Every edit
    or confirmed derivation creates a new version with `parent_version_id` and a
    content hash. A PromptVersion fixes the brief it uses through
    `prompt_input_submissions.character_brief_version_id`; later brief updates do
    not change old prompts or old art. A brief and references must not both be
    absent, so an image-only character is allowed.
12. **An ArtVersion's multiple references are a first-class snapshot.** The main
    table stores no `reference_asset_id`; all references live in `asset_links`
    with `owner_type='art_version'`, `sort_order`, `is_primary`, `role`, `note`,
    `weight`, and `locked`. Adopting a candidate makes the candidate image the
    new ArtVersion's primary and copies the previous active version's other
    references in order. Reference revision creates a new ArtVersion and never
    mutates links in place.
13. **Generation requests are frozen at enqueue time.** A generation job row
    stores `base_art_version_id` and `request_json` (the complete ordered
    references, collapse/truncation report, and PromptVersion hash). Workers
    consume only the snapshot and never re-read the active pointer, so a version
    switch during a run cannot make the request unreproducible.
14. **design-system is the only UI foundation.** `packages/design-system` ships
    with React as a peer dependency and owns tokens, primitives, patterns, and
    the gallery. Studio keeps only business composition and pages. Ardot screens
    1.1/1.2/1.3/1.4/1.5, 0A/0B, and S8 are the Phase 1 visual acceptance
    targets; screens 2A–2F, which are not drawn in Ardot, get navigation
    placeholders only, not fabricated implementations.
15. **Engineering conventions enter shared layers first.** IPC, sidecar
    endpoints, renderer global probes, and the request pipeline already converge
    on a single location. Phase 1 extends contracts and domain endpoints without
    duplicating transport. Every component uses Props plus `React.FC<Props>` from
    its first implementation.

## Product scope

- Phase 1 is a single-user, single-machine, single-local-workspace workbench.
- The local sidecar token is not a user identity; `local-user` is only an audit label.
- No accounts, registration, login, organizations, sharing, RBAC, or device sync in this phase.
- Domain tables do not add speculative `user_id` or `tenant_id` columns.

## Prompt input revision semantics

- `prompt_input_submissions.revision` equals the project's next draft revision at the time the user changes requirements/materials.
- Pure prompt-block saves increment `prompt_drafts.revision` but do not create a new input submission.
- A PromptVersion references exactly one input submission; its content snapshot is immutable.

## Provider capability defaults

- Seedream: 14 refs, no negative prompt, sequential count up to 4 in this phase.
- OpenAI-compatible chat: vision capability is declared per connection; unknown means no vision.
- Mock: deterministic JSON for reverse/suggestion and 512x896 PNG for image tests.

## Character brief semantics

- `character_brief_versions` rows are append-only; there is no UPDATE path except the active pointer on `characters`.
- The active brief is selected by `characters.active_brief_version_id`; creation may use `expectedActiveBriefVersionId` as CAS.
- A prompt input fixes `character_brief_version_id`; an inline brief is materialized into a version before the submission row is inserted.
- Brief text never enters logs, SSE payloads, or provider invocation metadata beyond the provider request body.

## ArtVersion reference semantics

- `asset_links.owner_type='art_version'` is the only source of truth for an ArtVersion's references; `art_versions` has no `reference_asset_id`.
- A valid set has 1..14 links, exactly one primary, primary order 0, auxiliary orders 1..N-1, unique assets, role from `ART_VERSION_REFERENCE_ROLES`, and weight 0.1..2.
- Revisions replace the whole set and create a new ArtVersion; source version links are never mutated.
- Candidate adoption uses the candidate asset as primary and copies the base active version's other links in order.
- Fork copies every link with new link IDs and the same asset IDs/blob hashes.

## Deviations from the data-model draft

- `generation_jobs.status` is derived from `jobs.status`; no duplicated column.
- `prompt_suggestions` supports draft bases with three added base fields, `context_json` for brief projection audit, and an exactly-one CHECK.
- `prompt_reverse_results` is added for asynchronous reverse outputs.
- `version_number` is added to prompt and art versions for UI labels.
- `prompt_drafts.content_hash`, `asset_links.locked` are added.
- Phase 1 does not edit reference pixels; the crop/rotate/brighten/remove-background controls are visible but disabled with a Phase 2 note. Metadata (`role`, `note`, `weight`, order, primary) is editable and revisioned.

## UI baseline

- `@agent2live/design-system` owns tokens, primitives, patterns, and the gallery.
- Studio pages reproduce the Ardot screens 1.1/1.2/1.3/1.4/1.5/0A/0B/S8 at 1440×900.
- Business components compose design-system primitives; no local Button/StatusPill/EmptyState/ErrorState/ConfirmDialog.
- Hex colors, ad-hoc radii, and duplicate tokens are rejected by `scripts/token-lint.mjs`.
