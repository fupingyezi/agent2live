# agent2live 工具初步定义 v1

> 日期：2026-11-12  
> 对应架构：[agent2live 技术方案 v1.4](./2026-11-06-idea-to-desktop-pet.md)  
> 数据模型：[数据模型 v1](./2026-11-08-data-model.md)  
> 阶段流程：[各阶段完整工作流](./2026-11-08-stage-workflows.md)

首版是单用户本地工作区。本文的 `actor`、`admin` 和“用户确认”都指当前本地操作者或本地 UI，不代表账号、组织角色或 RBAC。`local-user` 只是审计标签；本地 sidecar token 不是工具权限主体。工具授权按 Pet/工作区能力控制，不按用户 ID 过滤。

## 1. 工具设计原则

1. 工具名和输入输出 Schema 都带版本，Agent 只能看到当前启用的版本。
2. 工具不接收任意绝对路径、shell 命令或 shell 片段。
3. 读工具、候选工具和提交工具分开；提交工具不能在一次模型推理中替代人工确认。
4. 所有写工具必须接收 `baseVersionId`、`baseStateHash` 或 `If-Match` 语义。
5. 大结果写 Artifact/Blob，只把摘要、ID、hash 和小型结构化结果返回模型。
6. 工具错误使用问题定义表的稳定错误码，不返回自由文本异常。
7. 工具结果不被视为可信指令；第三方内容只作为数据。

## 2. 公共调用契约

### 2.1 Invocation

```json
{
  "schemaVersion": "tool-call/1",
  "invocationId": "inv_01J...",
  "traceId": "trc_01J...",
  "tool": "rig.compile_proposal",
  "toolVersion": "1.0",
  "actor": {
    "kind": "studio-agent",
    "runId": "run_01J..."
  },
  "scope": {
    "characterId": "chr_01J...",
    "artProjectId": "artp_01J...",
    "live2dProjectId": "l2d_01J..."
  },
  "base": {
    "stateHash": "sha256:...",
    "rowVersion": 7
  },
  "input": {}
}
```

### 2.2 Result

```json
{
  "schemaVersion": "tool-result/1",
  "invocationId": "inv_01J...",
  "ok": true,
  "data": {},
  "artifacts": [
    {
      "kind": "image",
      "assetId": "sha256:...",
      "mediaType": "image/png"
    }
  ],
  "warnings": [],
  "state": {
    "stateHash": "sha256:...",
    "revision": 8
  },
  "permission": {
    "required": false,
    "approvalId": null
  },
  "error": null
}
```

失败时 `ok=false`，`data=null`，`error` 使用统一 Problem/Job Error 子集。

### 2.3 工具类别

| 类别          | 行为                   | 是否可由 Agent 自动调用   |
| ------------- | ---------------------- | ------------------------- |
| `query`       | 只读查询               | 是                        |
| `compute`     | 只算结果，不修改       | 是                        |
| `proposal`    | 生成候选/提案          | 是                        |
| `artifact`    | 写入 staging/Blob/Job  | 是，但产物不发布          |
| `commit`      | 修改正式版本           | 需要确认或 approval proof |
| `external`    | 调用付费/联网服务      | 取决于用户策略            |
| `user-only`   | 删除、发布、最终审批等 | 否                        |
| `system-only` | 调度器、迁移、恢复     | 否                        |

## 3. 权限与审批

### 3.1 Tool Scopes

```text
project:read
project:write
prompt:read
prompt:suggest
prompt:commit
art:generate
art:commit
asset:write
live2d:analyze
live2d:build
rig:read
rig:propose
rig:preview
rig:apply
pet:read
pet:control
memory:read
memory:suggest
memory:delete
agent:start
agent:approve
admin:extensions
```

### 3.2 Approval Levels

| 等级 | 含义                                              |
| ---- | ------------------------------------------------- |
| `A0` | 只读，无确认                                      |
| `A1` | 生成本地计算结果或候选，无正式修改                |
| `A2` | 创建 Job/临时 Artifact，消耗本地或外部资源        |
| `A3` | 用户点击确认后提交正式版本                        |
| `A4` | 必须由 UI 生成一次性 approval proof，模型不可代签 |
| `A5` | 仅本地操作者/UI 可执行的动作，不注册给编码 Agent  |

### 3.3 Risk Classes

| 风险          | 典型能力                            | 默认策略                     |
| ------------- | ----------------------------------- | ---------------------------- |
| `read`        | 读当前时间、读取只读项目状态        | 自动允许                     |
| `network`     | 网络搜索、抓取网页                  | 关闭，用户授权               |
| `local_write` | 写本地文件、修改项目资产            | 每次确认                     |
| `high_risk`   | shell、桌面控制、支付、任意文件系统 | 默认禁止，不作为普通宠物工具 |

工具执行时同时校验 `toolDefinition.schemaHash` 与授权记录中的 `approvedSchemaHash`。MCP 或 Skill 更新后 hash 不一致，工具转为 `pending_reapproval`。

## 4. 项目、输入与 Prompt 工具

| 工具                           | 类别          | 主要输入                                  | 输出                                | 副作用         | 审批 |
| ------------------------------ | ------------- | ----------------------------------------- | ----------------------------------- | -------------- | ---- |
| `project.get_context@1.0`      | query         | `characterId/artProjectId`                | 项目阶段、active versions、分支摘要 | 无             | A0   |
| `project.get_lineage@1.0`      | query         | `rootProjectId`                           | 谱系节点和来源版本                  | 无             | A0   |
| `project.propose_fork@1.0`     | proposal      | `sourceVersionId`, `title`, `branchLabel` | Fork 预览和冲突项                   | 无             | A1   |
| `project.fork@1.0`             | commit        | proposalId, Idempotency-Key               | childProject、seed versions         | 新建项目/关系  | A3   |
| `prompt.get_input@1.0`         | query         | `inputSubmissionId`                       | 要求、素材角色与 hash               | 无             | A0   |
| `prompt.analyze_input@1.0`     | compute       | inputSubmissionId                         | 素材用途、要求冲突、缺失项          | 无             | A1   |
| `prompt.reverse@1.0`           | artifact      | draftId, provider/model, providerPolicy   | PromptReverseResult + state         | Job/候选       | A2   |
| `prompt.suggest_changes@1.0`   | proposal      | basePromptVersionId, intent               | operations、locked 命中、风险       | 无             | A1   |
| `prompt.accept_suggestion@1.0` | commit        | suggestionId, baseHash                    | 新 DraftRevision                    | 修改草稿       | A3   |
| `prompt.save_version@1.0`      | commit        | draftId, rowVersion                       | PromptVersion + 有序 references     | 新增不可变版本 | A3   |
| `prompt.compile@1.0`           | compute       | promptVersionId, providerConnectionId     | CompiledGenerationRequest + hash    | 无             | A1   |
| `prompt.explain_block@1.0`     | query/compute | blockId, context                          | 解释、证据、建议                    | 无             | A0   |

### 4.1 `prompt.reverse@1.0`

输入摘要：

```json
{
  "draftId": "pd_01J...",
  "inputSubmissionId": "inp_01J...",
  "providerPolicy": {
    "providerConnectionId": "conn_vision",
    "modelId": "vision-model"
  },
  "outputLocale": "zh-CN"
}
```

输出摘要：

```json
{
  "resultId": "prr_01J...",
  "status": "ready",
  "baseDraftId": "pd_01J...",
  "baseDraftRevision": 4,
  "state": {
    "schemaVersion": "prompt-spec/2",
    "fullPrompt": "反推后的连续提示词",
    "lockAll": false,
    "sourceRequirements": [],
    "materialRefs": [],
    "blocks": [],
    "negativeBlocks": [],
    "constraints": {
      "canvas": { "width": 1024, "height": 1792 },
      "background": "transparent",
      "aspect": "portrait"
    }
  }
}
```

错误：`PROMPT_INPUT_INVALID`、`PROMPT_REVERSE_STALE`、`PROVIDER_BAD_RESPONSE`。

### 4.2 `project.fork@1.0`

输入：

```json
{
  "source": {
    "kind": "art_version",
    "id": "art_01J..."
  },
  "title": "蓝发冬季服",
  "branchLabel": "蓝发冬季服"
}
```

约束：

- 源版本必须 committed，hash 不变。
- 只允许同 Character。
- Idempotency-Key 必填。
- Fork 不复制 Blob，不复制 Live2D 构建。

错误：`FORK_SOURCE_NOT_FOUND`、`FORK_SOURCE_UNCOMMITTED`、`FORK_CHARACTER_MISMATCH`、`FORK_RELATION_INVALID`。

## 5. Art / Generation 工具

| 工具                          | 类别              | 主要输入                                                                     | 输出                                       | 副作用        | 审批 |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------ | ------------- | ---- |
| `art.get_versions@1.0`        | query             | artProjectId                                                                 | 版本 DAG、active                           | 无            | A0   |
| `art.generate_candidates@1.0` | external/artifact | promptVersionId, provider/model, count, size, seed, optional base ArtVersion | Generation + candidates                    | 生成费用/Blob | A2   |
| `art.validate_candidate@1.0`  | compute           | candidateId                                                                  | 构图、尺寸、安全、hash                     | 无            | A1   |
| `art.compare_candidates@1.0`  | compute           | candidateIds                                                                 | 感知差异和指标                             | 无            | A1   |
| `art.accept_candidate@1.0`    | commit            | candidateId, expectedActiveVersionId                                         | ArtVersion(artwork asset) + active pointer | 版本切换      | A3   |
| `art.activate_version@1.0`    | commit            | artVersionId, reason                                                         | active pointer + audit                     | 版本切换      | A3   |

约束：

- `art.generate_candidates` 只能产生候选，不能改 active。
- 生成时服务端从 PromptVersion 读取 PromptSpec 与有序 references；调用方不能传任意旧 assetId。
- `baseArtVersionId` 省略时使用当前 active；只有 `includeBaseArtworkReference=true` 才把当前立绘追加到 references 末尾。
- ArtVersion 只保存 `artworkAssetId`、PromptVersion 和生成来源，不保存 references，也不定义主图。
- `art.accept_candidate` 必须校验 activeVersionId；冲突返回 `ART_ACTIVE_VERSION_CHANGED`。

## 6. 资产与分层工具

| 工具                      | 类别              | 主要输入                                                                   | 输出                                                | 副作用       | 审批 |
| ------------------------- | ----------------- | -------------------------------------------------------------------------- | --------------------------------------------------- | ------------ | ---- |
| `asset.inspect@1.0`       | query             | assetId                                                                    | MIME、尺寸、hash、provenance                        | 无           | A0   |
| `asset.link@1.0`          | commit            | assetId, owner(prompt_input/prompt_version/layer_spec/model), role, weight | asset link                                          | 关联资产     | A3   |
| `l2d.decompose_image@1.0` | external/artifact | artVersionId, qualityProfile                                               | LayerSpec candidate + PSD preview                   | GPU/外部任务 | A2   |
| `l2d.audit_layers@1.0`    | compute           | layerSpecCandidateId                                                       | 必需角色、误差、坐标问题                            | 无           | A1   |
| `l2d.propose_patch@1.0`   | proposal          | layerSpecVersionId, role, intent                                           | patch candidate                                     | 生成候选     | A2   |
| `l2d.accept_patch@1.0`    | commit            | patchCandidateId, baseLayerSpecId                                          | 新 LayerSpecVersion                                 | 正式补层     | A3   |
| `l2d.compose_psd@1.0`     | artifact          | layerSpecVersionId, variants                                               | BindingReadyPsd + compose report + LayerSpecVersion | 新图层版本   | A2   |
| `l2d.inspect_psd@1.0`     | compute           | psdAssetId                                                                 | 图层树、不支持特性、bbox                            | 无           | A0   |

`asset.link` 不能修改已提交 PromptVersion 或 ArtVersion。提示词或参考图变化必须提交新的 PromptVersion；`l2d.decompose_image` 使用 ArtVersion 的 `artworkAssetId`，不会把 PromptVersion references 自动并入 See-through 输入。

### 6.1 `l2d.propose_patch@1.0`

允许 `role`：

```text
eyes_closed, mouth_open, hair_patch, outfit_patch, svg_patch, other
```

输出必须包含：

```json
{
  "candidateId": "patch_01J...",
  "assetId": "sha256:...",
  "alignment": {
    "canvasMatch": true,
    "bboxDeltaPx": 0,
    "maxEdgeDeltaPx": 1
  },
  "confidence": 0.87,
  "requiresReview": true
}
```

## 7. Binding / Model 工具

| 工具                     | 类别              | 主要输入                                                                                                                       | 输出                     | 副作用      | 审批 |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ----------- | ---- |
| `l2d.plan_rig@1.0`       | proposal          | psdAssetId, template, rigOptions                                                                                               | RigPlan draft + risks    | 无          | A1   |
| `l2d.save_rig_plan@1.0`  | commit            | plan, basePlanId, sourceLayerSpecVersionId                                                                                     | RigPlanVersion           | 新增版本    | A3   |
| `l2d.build_model@1.0`    | artifact/external | baseArtVersionId, layerSpecVersionId, bindingReadyPsdAssetId, rigPlanVersionId, canvasTransform, targetCubismVersion, binderId | ModelBuild Job           | 启动 Binder | A2   |
| `l2d.inspect_model@1.0`  | query/compute     | modelBuildId                                                                                                                   | 文件树、参数、动作、诊断 | 无          | A0   |
| `l2d.run_qc@1.0`         | compute           | modelBuildId                                                                                                                   | QC report                | 无          | A1   |
| `l2d.publish_model@1.0`  | commit            | artifactId, petId, personaVersionId                                                                                            | active model binding     | 发布        | A4   |
| `l2d.compare_builds@1.0` | compute           | buildIds                                                                                                                       | 参数、动作、视觉差异     | 无          | A1   |

绑定器内部操作不直接暴露给 Studio Agent。Agent 只调用 `l2d.*` 语义工具，由 `BinderAdapter` 映射到当前 PSD2Live 版本的具体操作。

## 8. Rig Copilot 工具

| 工具                       | 类别             | 主要输入                         | 输出                        | 副作用    | 审批 |
| -------------------------- | ---------------- | -------------------------------- | --------------------------- | --------- | ---- |
| `rig.get_context@1.0`      | query            | sessionId, selection             | stateHash、对象、参数、诊断 | 无        | A0   |
| `rig.inspect_objects@1.0`  | query            | objectIds, depth                 | 对象图、父子关系、bbox      | 无        | A0   |
| `rig.list_parameters@1.0`  | query            | filter                           | 参数、范围、当前值          | 无        | A0   |
| `rig.sample_preview@1.0`   | compute/artifact | probes, quality                  | 渲染图、metrics             | 临时 Blob | A1   |
| `rig.compile_proposal@1.0` | proposal         | intent, targetIds, constraints   | RigEditProposal             | 无        | A1   |
| `rig.preview_proposal@1.0` | compute/artifact | proposalId                       | dry-run 诊断 + before/after | 临时预览  | A1   |
| `rig.compare_render@1.0`   | compute          | beforeAssetId, afterAssetId      | 像素差、区域差、警告        | 无        | A0   |
| `rig.apply_proposal@1.0`   | commit           | proposalId, approvalProof        | new state + RigPlanVersion  | 正式修改  | A4   |
| `rig.undo@1.0`             | commit           | live2dProjectId, targetVersionId | 回滚版本                    | 正式回滚  | A4   |

### 8.1 `rig.compile_proposal@1.0`

输入：

```json
{
  "sessionId": "rcs_01J...",
  "intent": "闭眼时避免上眼皮穿过睫毛",
  "targetIds": ["deformer:eyelid_l", "mesh:lashes_l"],
  "constraints": {
    "maxSemanticOperations": 8,
    "preserveTexture": true,
    "preserveParameterDefaults": true
  }
}
```

输出：

```json
{
  "proposalId": "rep_01J...",
  "baseStateHash": "sha256:...",
  "operationCount": 2,
  "estimatedRisk": "medium",
  "unmappedIntentParts": []
}
```

### 8.2 Preview presentation 契约

`rig.preview_proposal@1.0` 必须同时返回模型可读诊断和用户可读展示：

```json
{
  "proposalId": "rep_01J...",
  "previewStateId": "rps_01J...",
  "headline": "闭眼时睫毛不再穿出眼皮",
  "affectedAreas": ["左眼", "睫毛"],
  "visibleChanges": ["完全闭眼时不再露眼白", "睁眼状态保持不变"],
  "warnings": [],
  "beforeAfter": {
    "beforeAssetId": "sha256:...",
    "afterAssetId": "sha256:..."
  },
  "technicalDetails": {
    "operationCount": 2,
    "stateHash": "sha256:...",
    "checks": []
  }
}
```

UI 必须先渲染 `headline / visibleChanges / beforeAfter`，`technicalDetails` 默认折叠。只有 preview 成功后才显示“采用这个效果”。

### 8.3 `rig.apply_proposal@1.0`

输入：

```json
{
  "proposalId": "rep_01J...",
  "approvalProof": "apf_01J...",
  "expectedStateHash": "sha256:..."
}
```

约束：

- `approvalProof` 只能由用户查看预览后点击“采用这个效果”生成。
- proof 绑定 proposalId、stateHash、edits hash，单次使用。
- CAS 失败返回 `RIG_STATE_CHANGED`。
- 成功后写 Binder snapshot、RigPlanVersion 和 audit。

## 9. 桌宠内置工具、MCP 与 Skills

### 9.1 内置工具

| 工具                     | 风险    | 输入                       | 输出                               | 默认 |
| ------------------------ | ------- | -------------------------- | ---------------------------------- | ---- |
| `clock.now@1.0`          | read    | `timezone?`                | ISO time、timezone、weekday        | 开启 |
| `calc.eval@1.0`          | read    | 受限表达式                 | 数值/字符串                        | 开启 |
| `web.search@1.0`         | network | query、limit、locale       | 标题、URL、摘要、retrievedAt       | 关闭 |
| `web.fetch@1.0`          | network | URL、maxBytes、extractMode | 标题、正文、links、retrievedAt     | 关闭 |
| `system.get_context@1.0` | read    | 无                         | 当前时间、时区、语言、模型能力摘要 | 开启 |

`clock.now` 输入输出：

```json
{
  "input": { "timezone": "Asia/Shanghai" },
  "output": {
    "iso": "2026-11-08T14:32:10+08:00",
    "date": "2026-11-08",
    "weekday": "Sunday",
    "timezone": "Asia/Shanghai"
  }
}
```

`web.search` 输出不得只返回一段无来源文本；必须包含可点击的来源和检索时间。`web.fetch` 的外部正文标记 `trust: untrusted-external`，不能改变系统指令。

### 9.2 外部 MCP 工具的动态代理

用户安装的 MCP server 不从宿主代码中硬编码工具。Tool Gateway 在运行时发现并注册：

```text
mcp.<sourceId>.<externalToolName>@<schemaMajor>
```

MCP 工具调用前必须验证：

- source 已启用且健康。
- tool definition 当前 `review_status=approved`。
- 当前 Pet 有有效 grant。
- `approvedSchemaHash == tool.schemaHash`。
- 输入通过工具当前 JSON Schema。
- 风险等级允许当前会话的确认策略。

### 9.3 工具管理工具

以下工具只对本地设置 UI 或本地操作者开放，不注册给普通宠物模型；这里的“本地”不代表管理员账号或 RBAC 角色：

| 工具                    | 类别        | 说明                       | 审批 |
| ----------------------- | ----------- | -------------------------- | ---- |
| `tool_sources.list@1.0` | query       | 列出内置/MCP 源与健康      | A0   |
| `tool_sources.test@1.0` | external    | MCP 握手、鉴权、tools/list | A2   |
| `tool_sources.sync@1.0` | system-only | 重新发现工具和 schema hash | A5   |
| `tools.get@1.0`         | query       | 查看 schema、风险、变更    | A0   |
| `tools.set_grant@1.0`   | user-only   | 设置宠物级权限             | A5   |
| `skills.preview@1.0`    | user-only   | 解包、扫描、展示 manifest  | A5   |
| `skills.install@1.0`    | user-only   | 安装新版本                 | A5   |
| `skills.bind@1.0`       | user-only   | 给 Pet 启用并确认 scopes   | A5   |

### 9.4 Skills 加载

Skill 是上下文与资源包，不是一个可任意执行的超级工具。Runtime 只向模型暴露必要的 metadata 和选中后的正文：

```text
skill.list_available
skill.load_instructions
skill.read_reference
```

这些方法由 Skill Runtime 内部调用，受 token、文件大小和路径白名单限制。Skill 中 `scripts/` 默认不可执行。

### 9.5 桌宠对外 MCP 工具

这些工具面向 Codex、Claude、Claude Desktop 或其他 MCP 宿主。

| 工具                         | 输入                                              | 输出                                       | 副作用                   | 限制                  |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------ | ------------------------ | --------------------- |
| `pet_get_state`              | 无                                                | modelId、status、version、availableIntents | 无                       | 不返回 key/token      |
| `pet_speak`                  | `text ≤500`, `motion?`, `durationMs?`             | `{displayed:true}`                         | 气泡显示                 | 不写长期记忆          |
| `pet_emote`                  | `motion`, `intensity 0..1`                        | `{played:true}`                            | 播放动作                 | 缺失动作静默降级      |
| `pet_notify`                 | `title ≤100`, `body ≤500`, `level`                | `{notificationId}`                         | 气泡/系统通知            | 不写聊天历史          |
| `pet_report_task_checkpoint` | objective, status, completion?, summary, blockers | `{accepted:true}`                          | 更新 AgentTaskProjection | 不接收完整 transcript |
| `pet_list_models`            | 无                                                | 模型摘要                                   | 无                       | 不返回本地路径        |

`pet_speak` / `pet_emote` / `pet_notify` 默认不污染 Direct 对话，也不写入角色长期记忆。只有 `pet_report_task_checkpoint` 允许写 `task_summary` 投影。

### 9.6 工具结果上下文

返回模型的工具结果统一包装：

```json
{
  "tool": "web.search@1.0",
  "trust": "untrusted-external",
  "retrievedAt": "2026-11-08T14:32:10+08:00",
  "sourceCount": 3,
  "truncated": false,
  "data": []
}
```

单个工具结果默认不超过 32KB 或 8k tokens；超出时写临时 Artifact，模型只收到摘要和 artifactId。

## 10. Memory 工具

| 工具                        | 类别        | 输入                                        | 输出                  | 副作用           | 审批 |
| --------------------------- | ----------- | ------------------------------------------- | --------------------- | ---------------- | ---- |
| `memory.search@1.0`         | query       | petId, modelArtifactId, query, allowedKinds | 排序记忆摘要          | 无               | A0   |
| `memory.get@1.0`            | query       | memoryId                                    | 记忆详情和来源        | 无               | A0   |
| `memory.propose_update@1.0` | proposal    | candidates                                  | 去重/冲突后的变更提案 | 无               | A1   |
| `memory.commit_direct@1.0`  | system-only | conversationId                              | MemoryItem updates    | 写 Direct Memory | A5   |
| `memory.pin@1.0`            | commit      | memoryId                                    | pinned status         | 修改记忆         | A3   |
| `memory.delete@1.0`         | user-only   | memoryIds                                   | deleted status        | 删除记忆         | A5   |
| `memory.export@1.0`         | user-only   | scope                                       | export job            | 数据导出         | A5   |

Forward 模式不得注册或调用任何 Memory 工具。Agent 模式只允许 `task_summary` projection，不能使用 `memory.commit_direct`。

## 11. Agent 控制工具

| 工具                         | 类别     | 输入                                     | 输出                   | 副作用       | 审批 |
| ---------------------------- | -------- | ---------------------------------------- | ---------------------- | ------------ | ---- |
| `agent.start_task@1.0`       | external | provider, cwd, objective, permissionMode | AgentTask、session ref | 启动子进程   | A2   |
| `agent.send@1.0`             | external | agentTaskId, text                        | accepted               | 新 turn/输入 | A3   |
| `agent.interrupt@1.0`        | external | agentTaskId, turnId?                     | interrupted            | 停止执行     | A2   |
| `agent.resolve_approval@1.0` | commit   | approvalId, decision, scopeHash          | resolved               | 授权工具执行 | A4   |
| `agent.get_task@1.0`         | query    | agentTaskId                              | 状态、任务投影摘要     | 无           | A0   |
| `agent.resume@1.0`           | external | nativeSessionRef                         | resumed task           | 继续外部会话 | A3   |
| `agent.close@1.0`            | external | agentTaskId                              | closed                 | 回收进程     | A2   |

Agent 工具只能由 `AgentSupervisor` 执行，不能把 provider 原始 token 暴露给 renderer 或工作流模型。

## 12. Binder Adapter 工具

BinderAdapter 是宿主内部接口，不对模型开放：

| 方法             | 输入                        | 输出                          |
| ---------------- | --------------------------- | ----------------------------- |
| `inspect`        | BinderInstallContext        | 可用性、版本、能力、缺失依赖  |
| `start`          | project temp path, token    | process handle                |
| `importPsd`      | PSD asset path, state       | Binder state                  |
| `planRig`        | state, RigPlan              | 新 state + diagnostics        |
| `dryRunEdits`    | state, edits                | candidate state + diagnostics |
| `applyEdits`     | state, edits, expected hash | new state + history node      |
| `exportModel`    | state, output dir           | model file family + manifest  |
| `validateOutput` | output dir                  | QC findings                   |
| `snapshot`       | state                       | Binder project artifact       |
| `shutdown`       | process handle              | exit status                   |

任何底层 Binder 版本变化都必须更新 Adapter，不允许工作流直接引用 CLI 参数或 MCP 方法名。

## 13. Tool Runtime 校验顺序

每次工具调用固定经过：

```text
call envelope
  → tool version exists
  → Zod input validation
  → actor/scope permission
  → base version/CAS validation
  → approval proof validation
  → execute
  → output Schema validation
  → artifact/reference validation
  → audit/log
  → result
```

任一步失败都返回对应错误码，不执行后续动作。

## 14. 幂等策略

| 工具类型             | 幂等键                             |
| -------------------- | ---------------------------------- |
| 只读                 | invocationId 可复用，不写业务状态  |
| 候选生成             | `Idempotency-Key` + input hash     |
| 创建 Job             | `Idempotency-Key` 唯一             |
| 采纳/保存版本        | base version + operation hash      |
| Fork                 | `Idempotency-Key` + source version |
| Rig preview          | stateHash + editsHash              |
| Rig apply            | approvalProof 单次消费             |
| Agent start/send     | `clientRequestId`                  |
| Tool read            | invocationId + cache key           |
| MCP side-effect tool | approvalId + request hash          |
| Skill install        | content hash                       |

## 15. 首批错误码映射

| 工具域             | 错误码                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project/Fork       | `FORK_SOURCE_NOT_FOUND`, `FORK_SOURCE_UNCOMMITTED`, `FORK_CHARACTER_MISMATCH`, `FORK_RELATION_INVALID`                                                                                             |
| Prompt             | `PROMPT_INPUT_INVALID`, `PROMPT_INPUT_STALE`, `PROMPT_BASE_STALE`, `PROMPT_BLOCK_LOCKED`                                                                                                           |
| Art                | `ART_ACTIVE_VERSION_CHANGED`, `ART_CANDIDATE_INVALID`, `ART_PROVIDER_UNAVAILABLE`                                                                                                                  |
| Asset/Layer        | `ASSET_HASH_MISMATCH`, `PSD_UNSUPPORTED_FEATURE`, `LAYER_REQUIRED_ROLE_MISSING`                                                                                                                    |
| Binder/Model       | `BINDER_UNAVAILABLE`, `BINDER_TIMEOUT`, `BINDER_OUTPUT_INVALID`, `MODEL_QC_FAILED`                                                                                                                 |
| Rig                | `RIG_STATE_CHANGED`, `RIG_PROPOSAL_INVALID`, `RIG_SCOPE_DENIED`, `RIG_PREVIEW_FAILED`, `RIG_APPLY_FAILED`                                                                                          |
| Pet/Model          | `MODEL_RUNTIME_INCOMPATIBLE`, `RESOURCE_NOT_FOUND`                                                                                                                                                 |
| Memory             | `MEMORY_SCOPE_DENIED`                                                                                                                                                                              |
| Agent              | `AGENT_UNAVAILABLE`, `AGENT_AUTH_REQUIRED`, `AGENT_PROTOCOL_MISMATCH`, `AGENT_TURN_IN_PROGRESS`, `AGENT_APPROVAL_EXPIRED`, `AGENT_APPROVAL_SCOPE_MISMATCH`                                         |
| Built-in/MCP Tools | `TOOL_NOT_FOUND`, `TOOL_DISABLED`, `TOOL_PERMISSION_DENIED`, `TOOL_APPROVAL_REQUIRED`, `TOOL_SCHEMA_CHANGED`, `TOOL_SOURCE_UNAVAILABLE`, `TOOL_TIMEOUT`, `TOOL_OUTPUT_INVALID`, `NETWORK_DISABLED` |
| Skills             | `SKILL_INVALID`, `SKILL_SCOPE_DENIED`, `SKILL_BUDGET_EXCEEDED`                                                                                                                                     |

## 16. 工具审计字段

所有写工具和外部工具在 `audit_events` 写入：

```json
{
  "action": "rig.apply_proposal",
  "actor": { "kind": "local-user", "id": "local-operator" },
  "target": { "type": "rig-proposal", "id": "rep_01J..." },
  "outcome": "success",
  "beforeHash": "sha256:...",
  "afterHash": "sha256:...",
  "metadata": {
    "invocationId": "inv_01J...",
    "approvalProofId": "apf_01J...",
    "operationCount": 4
  }
}
```

日志可记录工具名、耗时、状态和 hash；不能记录完整 Prompt、工具大输出、文件内容、命令或 approvalProof 明文。
