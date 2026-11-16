# 提示词工作台一体化编辑器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把完整提示词和颗粒化提示词实现为同一个 PromptSpec 的同步表示，并让左侧版本、右侧提示词编辑、中间画布和 Modal 操作按已确认设计工作。

**Architecture:** 在 `PromptSpecV2` 内新增 `fullPrompt`，保留现有 blocks 作为结构化真源。新增 DeepSeek 驱动的 `prompt.sync` Job，把用户最后修改的一侧同步成另一侧；Workbench 用统一选中版本同时加载 PromptVersion 与 ArtVersion，并在右侧角色描述栏完成编辑、保存和生成入口。

**Tech Stack:** Electron、React、TypeScript、TanStack Query、Zustand、Fastify、Zod、SQLite Job、DeepSeek Chat Provider、Playwright、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-16-prompt-workbench-unified-editor-design.md`

## Global Constraints

- `PromptSpecV2` 是完整提示词和颗粒化提示词的唯一持久化主体。
- `fullPrompt` 必须与 blocks 参与同一个 content hash、Draft Revision、PromptVersion 和 Fork。
- 完整提示词是连贯自然语言，不得按“一块一行”展示。
- 保存时以最后编辑的一侧为权威输入，并由 DeepSeek 同步另一侧。
- 锁定块不得被 AI 静默修改。
- 保存同步结果必须作为同一个 Draft Revision 原子落库。
- 生成只能使用已提交的 PromptVersion。
- 左侧节点切换时，ArtVersion、其 `promptVersionId`、参考图和立绘一起切换。
- 中间画布不得出现长期存在的提示词表单、生成设置卡片或页面下方的第二套编辑器。
- 生成设置、候选接受、手工上传、历史版本还原和 Fork 使用 Modal。
- 历史版本不能直接生成；必须先还原出一个新的 ArtVersion 并设为 active。
- DeepSeek 只用于完整/颗粒提示词同步和文本初始化；智谱只用于参考图反推；Seedream 只用于生图。
- 已有 PromptSpec 和 PromptVersion 缺少 `fullPrompt` 时必须可读，不新增数据库迁移。
- 设计基线继续为 1440×900，并保留 axe、token lint、reduced-motion 和视觉回归。
- 执行实现前先移除当前未提交的试错性弹窗改动，不得把它们作为基线。

## Review Focus

- **完整提示词与锁定块冲突：** 用户直接修改完整提示词后，AI 可能尝试改写锁定身份块；必须保留锁定块并要求用户处理冲突。
- **历史版本切换：** 用户选择旧 ArtVersion 后，右侧必须显示该版本关联的 PromptVersion，不能误用项目当前 active prompt。
- **未保存时切换版本：** 用户切换左侧版本时必须选择保存、放弃或取消，不能静默丢失当前编辑。
- **无 DeepSeek / 无智谱：** 创建和编辑仍可保存已有内容；对应 AI 优化明确跳过，不把创建判为失败。
- **同步后的旧草稿：** AI Job 运行期间草稿被修改时，必须返回并发冲突，不得应用旧结果。

---

### Task 1: PromptSpec 加入 fullPrompt 并兼容旧数据

**Files:**

- Modify: `packages/contracts/src/prompt.ts`
- Modify: `packages/contracts/src/prompt.test.ts`
- Create: `apps/server/src/prompt/full-prompt.ts`
- Create: `apps/server/src/prompt/full-prompt.test.ts`
- Modify: `apps/server/src/prompt/compile.ts`
- Modify: `apps/server/src/services/prompt-drafts.ts`
- Modify: `apps/server/tests/prompt-drafts.test.ts`
- Modify: `apps/server/tests/prompt-compile.test.ts`

**Interfaces:**

- Consumes: existing `PromptSpecV2`, blocks, `specContentHash`.
- Produces:

```ts
interface PromptSpecV2 {
  fullPrompt: string
  // existing fields unchanged
}

function normalizeLegacyFullPrompt(spec: PromptSpecV2): PromptSpecV2
```

- [ ] **Step 1: 写 fullPrompt 契约与旧数据测试**

测试断言：

- `fullPrompt` 最长 20,000 字符并允许空字符串用于未优化草稿。
- 缺少 `fullPrompt` 的旧 JSON 能被读取并补齐。
- `specCoreOf(spec)` 包含 `fullPrompt`。
- 修改仅 `fullPrompt` 会改变 content hash。
- `normalizeLegacyFullPrompt` 对旧数据生成非空、稳定、无重复的完整提示词。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/contracts/src/prompt.test.ts apps/server/src/prompt/full-prompt.test.ts apps/server/tests/prompt-compile.test.ts apps/server/tests/prompt-drafts.test.ts`

Expected: FAIL；`fullPrompt` 不是 PromptSpec 字段。

- [ ] **Step 3: 实现契约与规范化**

在 `promptSpecShape` 中加入 `fullPrompt: z.string().trim().max(20_000).default('')`，在 `specCoreOf`、`EMPTY_STATE`、所有 server 读取 PromptSpec 的边界调用 `normalizeLegacyFullPrompt`。旧值按固定 category 顺序和 block 顺序生成连贯句子；新值原样保留。

- [ ] **Step 4: 复跑并运行完整 Vitest**

Run: `pnpm exec vitest run packages/contracts/src/prompt.test.ts apps/server/src/prompt/full-prompt.test.ts apps/server/tests/prompt-compile.test.ts apps/server/tests/prompt-drafts.test.ts`

Run: `pnpm test`

Expected: targeted tests PASS，完整 Vitest 0 failed。

- [ ] **Step 5: 提交**

```bash
git add packages/contracts/src/prompt.ts packages/contracts/src/prompt.test.ts \
  apps/server/src/prompt/full-prompt.ts apps/server/src/prompt/full-prompt.test.ts \
  apps/server/src/prompt/compile.ts apps/server/src/services/prompt-drafts.ts \
  apps/server/tests/prompt-drafts.test.ts apps/server/tests/prompt-compile.test.ts
git commit -m "feat(prompt): add unified full prompt"
```

---

### Task 2: DeepSeek 双向提示词同步 Job

**Files:**

- Create: `packages/contracts/src/prompt-sync.ts`
- Create: `packages/contracts/src/prompt-sync.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/prompt/sync.ts`
- Create: `apps/server/src/prompt/sync.test.ts`
- Create: `apps/server/src/services/prompt-sync.ts`
- Create: `apps/server/src/jobs/prompt-sync.ts`
- Create: `apps/server/src/routes/prompt-sync.ts`
- Create: `apps/server/tests/prompt-sync.test.ts`
- Modify: `apps/server/src/services/container.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/desktop/src/renderer/studio/api/queries.ts`
- Modify: `apps/desktop/src/renderer/studio/api/index.ts`

**Interfaces:**

- Consumes: `PromptSpecV2`, `PromptOperation`, `applyPromptOperations`, Chat Provider registry.
- Produces:

```ts
type PromptEditSource = 'full' | 'blocks'

interface PromptSyncInput {
  providerConnectionId: string
  source: PromptEditSource
  mode: 'sync' | 'optimize'
  state: PromptSpecV2
}

interface PromptSyncConflict {
  blockId: string
  message: string
}

interface PromptSyncResultDto {
  state: PromptSpecV2
  conflicts: PromptSyncConflict[]
  warnings: string[]
}

function requestPromptSync(
  projectId: string,
  draftId: string,
  input: PromptSyncInput,
  ifMatch: number
): Promise<{ jobId: string }>
```

- [ ] **Step 1: 写输出 Schema 与同步纯函数测试**

覆盖：

- `source='full'` 保存用户原文，只允许 AI 操作未锁定块。
- `source='blocks'` 只采用 AI 返回的完整提示词，blocks 保持用户输入。
- 锁定块冲突返回 `conflicts` 且两边内容不变。
- 未知 block ID、no-op operation、空 fullPrompt 被拒绝。
- `mode='optimize'` 时完整提示词和 blocks 必须同时非空。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run packages/contracts/src/prompt-sync.test.ts apps/server/src/prompt/sync.test.ts`

Expected: FAIL；模块不存在。

- [ ] **Step 3: 实现同步 Schema、Prompt Builder 和结果应用**

`buildPromptSyncMessages` 必须给模型提供当前 fullPrompt、全部 blocks、block metadata 和 allowed operations。`applyPromptSyncOutput` 不接受任何锁定块变更；有冲突时返回原 spec。

- [ ] **Step 4: 实现 Job 与 HTTP 路由**

`POST /api/v1/art-projects/:id/prompt-drafts/:draftId/sync` 使用 `If-Match` 校验草稿 rowVersion，要求 idempotency key，返回 202 `{ jobId }`。Job timeout 为 120 秒，Provider timeout 为 90 秒。

- [ ] **Step 5: 写 API 集成测试**

测试 fake Chat Provider 分别同步 full→blocks 和 blocks→full；断言 job result 的 state、warnings、conflicts，以及旧 rowVersion 请求返回 409。

Run: `pnpm exec vitest run apps/server/tests/prompt-sync.test.ts packages/contracts/src/prompt-sync.test.ts apps/server/src/prompt/sync.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/contracts/src/prompt-sync.ts packages/contracts/src/prompt-sync.test.ts packages/contracts/src/index.ts \
  apps/server/src/prompt/sync.ts apps/server/src/prompt/sync.test.ts \
  apps/server/src/services/prompt-sync.ts apps/server/src/jobs/prompt-sync.ts \
  apps/server/src/routes/prompt-sync.ts apps/server/tests/prompt-sync.test.ts \
  apps/server/src/services/container.ts apps/server/src/index.ts \
  apps/desktop/src/renderer/studio/api/queries.ts apps/desktop/src/renderer/studio/api/index.ts
git commit -m "feat(prompt): add bidirectional prompt sync"
```

---

### Task 3: 创建角色时接入文本优化与图片反推

**Files:**

- Modify: `apps/desktop/src/renderer/studio/providers/presets.ts`
- Modify: `apps/desktop/src/renderer/studio/providers/presets.test.ts`
- Modify: `apps/desktop/src/renderer/studio/routes/NewCharacterPage.tsx`
- Modify: `apps/desktop/src/renderer/studio/api/queries.ts`
- Modify: `e2e/studio-shell.spec.ts`

**Interfaces:**

- Consumes: `requestPromptSync`, `savePromptDraft`, `requestPromptReverse`.
- Produces:

```ts
function findDefaultTextProvider(providers: ProviderConnectionDto[]): ProviderConnectionDto | null

interface CharacterPromptProvision {
  draft: PromptDraftDto
  aiWarning: 'no-text-provider' | 'text-optimize-failed' | 'no-vision-provider' | 'vision-start-failed' | null
  initialReverseJobId: string | null
}
```

- [ ] **Step 1: 写 Provider 选择与创建流程测试**

断言仅选择 enabled DeepSeek Chat；无 DeepSeek 时跳过文本优化；文本优化成功后保存 fullPrompt + blocks；有智谱时再以保存后的草稿启动反推。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/desktop/src/renderer/studio/providers/presets.test.ts`

Run: `pnpm exec playwright test e2e/studio-shell.spec.ts --grep "text-only" --reporter=list`

Expected: FAIL；没有文本 Provider 选择和初始化优化。

- [ ] **Step 3: 实现文本初始化编排**

提交 PromptInput 后：

1. 选 DeepSeek；
2. 以 `{source:'full', mode:'optimize'}` 请求同步；
3. 轮询 Job 至结束；
4. 用返回 state 保存 PromptDraft；
5. 有智谱时再请求参考图反推；
6. 导航到 0A 时携带文本/反推警告和反推 Job ID。

任何一步 AI 失败都保留已创建 Character、ArtProject 和可保存草稿。

- [ ] **Step 4: 复跑并提交**

Run: `pnpm exec vitest run apps/desktop/src/renderer/studio/providers/presets.test.ts`

Run: `pnpm exec playwright test e2e/studio-shell.spec.ts --grep "text-only|reference images" --reporter=list`

Expected: PASS；警告与跳转参数正确。

```bash
git add apps/desktop/src/renderer/studio/providers/presets.ts \
  apps/desktop/src/renderer/studio/providers/presets.test.ts \
  apps/desktop/src/renderer/studio/routes/NewCharacterPage.tsx \
  apps/desktop/src/renderer/studio/api/queries.ts e2e/studio-shell.spec.ts
git commit -m "feat(studio): optimize creation prompts"
```

---

### Task 4: 左侧版本与右侧一体化提示词编辑器联动

**Files:**

- Create: `apps/desktop/src/renderer/studio/workbench/components/WorkbenchVersionRail.tsx`
- Create: `apps/desktop/src/renderer/studio/workbench/components/UnifiedPromptInspector.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/Workbench.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/components/PromptBlockList.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/components/DraftToolbar.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/components/ArtVersionPanel.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/store.ts`
- Modify: `apps/desktop/src/renderer/studio/api/queries.ts`
- Modify: `packages/contracts/src/api.ts`
- Modify: `apps/server/src/services/prompt-drafts.ts`
- Modify: `apps/server/tests/prompt-drafts.test.ts`
- Modify: `e2e/workbench.spec.ts`

**Interfaces:**

- Consumes: ArtVersion `promptVersionId`, `getPromptVersion`, prompt sync API.
- Produces:

```ts
interface CreateDraftFromVersionInput {
  from: 'version'
  versionId: string
}

interface UnifiedPromptInspectorProps {
  project: ArtProjectDto
  selectedArtVersion: ArtVersionDto | null
  selectedPromptVersion: PromptVersionDto | null
  draft: PromptDraftDto | null
  spec: PromptSpecV2 | null
  dirty: boolean
  onSave(): Promise<void>
  onGenerate(): void
}

interface WorkbenchStore {
  lastEdited: PromptEditSource | null
  updateFullPrompt(fullPrompt: string): void
}
```

- [ ] **Step 1: 写历史版本切换与 fullPrompt 编辑测试**

断言：

- 点击左侧美术 v1，右侧显示 v1 的 PromptVersion；
- fullPrompt textarea 存在且不是 block 行列表；
- 修改 fullPrompt 标记 dirty；
- 修改 block 标记 dirty；
- 从历史 PromptVersion 可创建对应草稿；
- 切换未保存版本触发保存/放弃/取消；
- 选中非 active 历史版本时生成按钮不可用。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "switches version|full prompt" --reporter=list`

Expected: FAIL；右侧仍是五块摘要且版本卡不可选。

- [ ] **Step 3: 扩展草稿创建接口**

`createDraftInputSchema` 改为判别联合，增加 `{from:'version', versionId}`；服务端以指定 PromptVersion 作为 seed，不要求它是 active。

- [ ] **Step 4: 实现版本联动**

Workbench 保存 `selectedArtVersionId`；左栏显示草稿节点和所有 ArtVersion。选择节点后加载关联 PromptVersion，右侧显示其 fullPrompt 和 blocks。历史版本进入编辑前创建 from-version 草稿。

- [ ] **Step 5: 实现右侧一体化编辑器**

`UnifiedPromptInspector` 上部是多行完整提示词，下部是现有颗粒编辑控件，底部固定保存/AI 优化/生成。fullPrompt 和 blocks 的修改都写同一 Zustand draft，并记录 `lastEdited`。

- [ ] **Step 6: 实现保存同步**

保存时调用 `prompt.sync`，成功后用返回 state 调用 `savePromptDraft`。冲突、stale draft、schema failure 都显示在原 Inspector，不丢失本地输入。

- [ ] **Step 7: 复跑并提交**

Run: `pnpm exec vitest run apps/server/tests/prompt-drafts.test.ts apps/desktop/src/renderer/studio/workbench/store.test.ts`

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "switches version|full prompt" --reporter=list`

Expected: PASS。

```bash
git add apps/desktop/src/renderer/studio/workbench/components/WorkbenchVersionRail.tsx \
  apps/desktop/src/renderer/studio/workbench/components/UnifiedPromptInspector.tsx \
  apps/desktop/src/renderer/studio/workbench/Workbench.tsx \
  apps/desktop/src/renderer/studio/workbench/components/PromptBlockList.tsx \
  apps/desktop/src/renderer/studio/workbench/components/DraftToolbar.tsx \
  apps/desktop/src/renderer/studio/workbench/components/ArtVersionPanel.tsx \
  apps/desktop/src/renderer/studio/workbench/store.ts \
  apps/desktop/src/renderer/studio/api/queries.ts packages/contracts/src/api.ts \
  apps/server/src/services/prompt-drafts.ts apps/server/tests/prompt-drafts.test.ts \
  e2e/workbench.spec.ts
git commit -m "feat(studio): link versions to unified prompt editor"
```

---

### Task 5: 还原历史版本并创建新的 ArtVersion

**Files:**

- Modify: `packages/contracts/src/api.ts`
- Modify: `packages/contracts/src/api.test.ts`
- Modify: `apps/server/src/services/art-versions.ts`
- Modify: `apps/server/src/routes/art-versions.ts`
- Modify: `apps/server/tests/art-versions.test.ts`
- Modify: `apps/desktop/src/renderer/studio/api/queries.ts`
- Modify: `apps/desktop/src/renderer/studio/workbench/components/ArtVersionPanel.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/components/UnifiedPromptInspector.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/Workbench.tsx`
- Modify: `e2e/workbench.spec.ts`

**Interfaces:**

- Consumes: selected historical `ArtVersionDto`, its linked `promptVersionId`, project rowVersion.
- Produces:

```ts
function restoreArtVersion(
  projectId: string,
  versionId: string,
  expectedProjectRowVersion: number,
  idempotencyKey?: string
): Promise<ArtVersionMutationDto>
```

新 ArtVersion 规则：

```text
versionNumber = max(existing) + 1
promptVersionId = selected.promptVersionId
originVersionId = selected.id
references = clone(selected.references)
activeVersionId = new ArtVersion id
```

- [ ] **Step 1: 写服务与接口失败测试**

测试断言：

- 还原后新增一个 ArtVersion，旧版本仍存在；
- 新版本复制完整有序参考图、主图、角色、权重、立绘和 source；
- 新版本复用原 `promptVersionId`；
- 新版本 `originVersionId` 指向旧版本；
- active 指针移动到新版本；
- 相同 idempotency key 不重复创建；
- 旧 project rowVersion 返回 409。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run apps/server/tests/art-versions.test.ts`

Expected: FAIL；不存在 restore 操作。

- [ ] **Step 3: 实现 restore 服务和路由**

新增 `POST /api/v1/art-projects/:id/art-versions/:versionId/restore`。事务内复制版本、创建审计和事件、更新 active，并返回 `ArtVersionMutationDto`。

- [ ] **Step 4: 写 UI 行为失败测试**

断言选中非 active 历史版本时生成按钮禁用，并显示“还原此版本”；确认 Modal 后出现新版本节点并设为 active，随后生成按钮才启用。

- [ ] **Step 5: 实现右侧还原入口**

历史版本选中时，`UnifiedPromptInspector` 底部显示“还原此版本”并通过 ConfirmDialog 执行。还原成功后选中返回的新 ArtVersion，不修改旧历史节点。

- [ ] **Step 6: 复跑并提交**

Run: `pnpm exec vitest run packages/contracts/src/api.test.ts apps/server/tests/art-versions.test.ts`

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "restore historical version" --reporter=list`

Expected: PASS。

```bash
git add packages/contracts/src/api.ts packages/contracts/src/api.test.ts \
  apps/server/src/services/art-versions.ts apps/server/src/routes/art-versions.ts \
  apps/server/tests/art-versions.test.ts apps/desktop/src/renderer/studio/api/queries.ts \
  apps/desktop/src/renderer/studio/workbench/components/ArtVersionPanel.tsx \
  apps/desktop/src/renderer/studio/workbench/components/UnifiedPromptInspector.tsx \
  apps/desktop/src/renderer/studio/workbench/Workbench.tsx e2e/workbench.spec.ts
git commit -m "feat(studio): restore historical art versions"
```

---

### Task 6: 生成和候选操作改为 Modal

**Files:**

- Create: `apps/desktop/src/renderer/studio/workbench/components/GenerationDialog.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/components/GenerationPanel.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/components/ArtVersionPanel.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/Workbench.tsx`
- Modify: `apps/desktop/src/renderer/studio/workbench/components/CandidateCompare.tsx`
- Modify: `apps/desktop/src/renderer/studio/app.css`
- Modify: `e2e/workbench.spec.ts`

**Interfaces:**

- Consumes: UnifiedPromptInspector 的 Generate 动作和已提交 PromptVersion。
- Produces:

```ts
interface GenerationDialogProps {
  open: boolean
  project: ArtProjectDto
  workspace: PromptWorkspaceDto
  providers: ProviderConnectionDto[]
  onClose(): void
}
```

- [ ] **Step 1: 写 Modal 交互测试**

断言：生成按钮只打开 Modal；画布内不存在 `generation-controls` 卡片；Modal 内可选模型、尺寸、数量、Seed；未保存提示词时生成按钮不可用。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "generation modal" --reporter=list`

Expected: FAIL；当前生成设置是画布 overlay。

- [ ] **Step 3: 实现 GenerationDialog**

复用 GenerationPanel 的创建 mutation 和候选轮询逻辑，但把设置表单放入 Dialog。提交成功后关闭 Modal，中间画布展示任务状态和候选。

- [ ] **Step 4: 整理其他 Modal**

候选接受继续使用 ConfirmDialog；手工上传、还原历史版本、Fork 都搬到对应 Dialog，并从主编辑区删除内联设置。

- [ ] **Step 5: 复跑并提交**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "generation modal|candidate" --reporter=list`

Expected: PASS。

```bash
git add apps/desktop/src/renderer/studio/workbench/components/GenerationDialog.tsx \
  apps/desktop/src/renderer/studio/workbench/components/GenerationPanel.tsx \
  apps/desktop/src/renderer/studio/workbench/components/ArtVersionPanel.tsx \
  apps/desktop/src/renderer/studio/workbench/Workbench.tsx \
  apps/desktop/src/renderer/studio/workbench/components/CandidateCompare.tsx \
  apps/desktop/src/renderer/studio/app.css e2e/workbench.spec.ts
git commit -m "feat(studio): move generation actions to dialogs"
```

---

### Task 7: 删除页面下方旧编辑器并完成视觉回归

**Files:**

- Modify: `apps/desktop/src/renderer/studio/workbench/Workbench.tsx`
- Modify: `apps/desktop/src/renderer/studio/app.css`
- Modify: `e2e/workbench.spec.ts`
- Modify: `e2e/studio-shell.spec.ts`
- Modify: `e2e/golden-chain.spec.ts`
- Modify: `e2e/ui-evidence.spec.ts`
- Modify: `e2e/visual-baselines/phase1/workbench-references-1440x900.png`
- Modify: `e2e/visual-baselines/phase1/workbench-candidates-1440x900.png`
- Modify: `docs/plans/evidence/phase1/ui/design-review.json`

**Interfaces:**

- Consumes: Tasks 1–6 的版本栏、Inspector、还原和 Modal。
- Produces: 无页面下方 `workbench-functional-dock` 的最终 Workbench。

- [ ] **Step 1: 写结构回归测试**

断言页面文档高度不超过 900px 主框架，`workbench-functional-dock` 不存在；右侧完整提示词和颗粒块可见；生成、候选、版本操作均为 Dialog。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec playwright test e2e/workbench.spec.ts --grep "no page tail" --reporter=list`

Expected: FAIL；当前仍有页面下方的 functional dock。

- [ ] **Step 3: 删除旧布局并更新样式**

移除 `workbench-functional-dock` 及对应页面流 CSS；右侧 Inspector 独立滚动，左栏固定 220px，中间 flexible，右栏 320px。页面不存在纵向设计外内容。

- [ ] **Step 4: 重建 1.3/1.4 基线和截图**

Run: `pnpm --filter @agent2live/desktop build`

Run: `pnpm exec playwright test e2e/ui-evidence.spec.ts --reporter=list --update-snapshots`

Run: `pnpm exec playwright test e2e/ui-evidence.spec.ts --reporter=list`

Expected: PASS；`Prompt workbench: 10/10`，axe 和 token lint 通过。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/studio/workbench/Workbench.tsx \
  apps/desktop/src/renderer/studio/app.css e2e/workbench.spec.ts e2e/studio-shell.spec.ts \
  e2e/golden-chain.spec.ts e2e/ui-evidence.spec.ts e2e/visual-baselines/phase1
git commit -m "fix(studio): remove page-level prompt dock"
```

---

### Task 8: 全链路与最终门禁

**Files:**

- Modify: `.superpowers/sdd/2026-11-16-prompt-workbench-unified-editor/progress.md`
- No production files expected unless tests expose a defect.

**Interfaces:**

- Consumes: Tasks 1–6 全部实现。
- Produces: 可提交的完整链路和门禁证据。

- [ ] **Step 1: 运行静态检查与单测**

Run: `pnpm check`

Expected: PASS；Vitest、类型、风格、格式和禁入资产全部通过。

- [ ] **Step 2: 运行完整 Electron suite**

Run:

```bash
AGENT2LIVE_MODEL_ROOT=/Users/yoshiko/code/live2D/CubismWebSamples/Samples/Resources \
AGENT2LIVE_PACKAGED_APP=/Users/yoshiko/code/live2D/agent2live/apps/desktop/release/mac-arm64/agent2live.app/Contents/MacOS/agent2live \
pnpm exec playwright test --reporter=list
```

Expected: 0 failed、0 skipped、0 flaky。

- [ ] **Step 3: 验证 DeepSeek 真实文本同步**

Run: `AGENT2LIVE_REAL_PROVIDERS=1 pnpm test:real-providers`

Expected: Chat 和 Image 均为 PASS。

- [ ] **Step 4: 验证智谱反推未回归**

Run:

```bash
zsh -c 'set -a; source /Users/yoshiko/code/agent/deepresearch/.env; set +a; \
AGENT2LIVE_REAL_PROVIDERS=vision pnpm test:real-providers'
```

Expected: Vision PASS，Schema 通过。

- [ ] **Step 5: 重建门禁证据并运行门禁**

Run:

```bash
pnpm native:node
pnpm exec vitest run --reporter=json --outputFile=/private/tmp/agent2live-unified-prompt-vitest.json
node scripts/collect-test-evidence.mjs vitest /private/tmp/agent2live-unified-prompt-vitest.json docs/plans/evidence/phase1/vitest.json
node scripts/collect-phase0-prerequisite.mjs
pnpm phase1:gate
node scripts/phase1-convergence-gate.mjs --require-real-providers
```

Expected: Phase 1 Gate PASS；Convergence Gate 全部 PASS。

- [ ] **Step 6: 最终提交与自审**

确认工作树干净后记录最终提交。按无子代理权限执行一次完整自审，检查完整提示词双向同步、锁定冲突、历史版本切换和 Modal 职责。

```bash
git status --short
git log -5 --oneline
```

---

## Self-Review

- Spec coverage: fullPrompt、双向 AI 同步、锁定冲突、版本联动、右侧 Inspector、Modal 和创建双路径均有对应任务。
- Restore coverage: Task 5 明确历史版本必须还原成新的 ArtVersion 并成为 active 后才能生成。
- Type consistency: 全计划统一使用 `fullPrompt`、`PromptEditSource`、`PromptSyncResultDto` 和 `selectedArtVersionId`，未引入平行命名。
- Failure coverage: 无 Provider、AI Schema 失败、stale draft、锁定冲突和未保存切版本均有测试任务。
- Visual coverage: Task 7 明确删除页面下方旧编辑器，并重建 1.3/1.4 基线与 axe/token 证据。
- Proportion: 计划以接口、测试和验收为主，没有预写生产函数实现体。
