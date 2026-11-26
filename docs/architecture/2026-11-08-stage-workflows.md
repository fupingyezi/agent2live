# agent2live 各阶段完整工作流

> 日期：2026-11-26
> 对应架构：[agent2live 技术方案 v1.7](./2026-11-06-idea-to-desktop-pet.md)
> Live2D 主规格：[四段工作台架构](./2026-11-26-live2d-four-stage-workbench.md)
> 约定：实线是正常流程，虚线是失败、回退或旁路；黄色节点表示人工确认或人工兜底。

首版流程运行在一个本地单用户工作区内。流程中的“用户”指当前 OS 用户/本地操作者，不是账号、组织成员或 RBAC 角色；不存在登录、切换用户、共享或跨设备同步步骤。未来新增账号系统时，应在其外层增加工作区/账号适配，不改变本文的版本链和人工门禁。

## 0. 全链路总览

```mermaid
flowchart LR
  Idea["想法 / 设定 / 素材"] --> Character["角色与 ArtProject"]
  Character --> Intake["角色设定或素材<br/>+ 可选创作要求<br/>PromptInputSubmission"]
  Intake --> Prompt["颗粒化提示词<br/>Prompt Draft / Version"]
  Prompt --> Generate["生图任务与候选"]
  Generate --> Art["ArtVersion<br/>最终立绘 + 生成来源"]
  Prompt --> Fork["从不可变版本 Fork"]
  Art --> Fork
  Fork --> Child["子 ArtProject<br/>谱系树分组"]
  Child --> Prompt
  Art --> Prepare["Live2D 立绘准备<br/>适用性检查 + 提示词优化"]
  Prepare --> Decompose["See-through 分层"]
  Decompose --> Psd["Live2D PSD 图层工作台"]
  Psd --> Rig["Live2D 绑定与交付"]
  Rig --> Build["ModelBuild + 本页验收"]
  Build --> Pet["交给桌宠系统"]
  Pet --> Direct["Direct LLM"]
  Direct --> Tools["MCP / Skills /<br/>时间与搜索工具"]
  Pet --> Forward["Forward App"]
  Pet --> Agent["Codex / Claude"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  classDef external fill:#5d6268,color:#fff,stroke:#42474c;
  class Prompt,Generate,Rig gate;
  class Art,Prepare,Build artifact;
  class Decompose,Psd,Direct,Forward,Agent external;
```

所有阶段共享三条横切规则：

1. 写操作必须绑定明确的输入版本，并使用 `If-Match`、CAS 或 `Idempotency-Key`。
2. 长任务先创建持久 Job，立即返回 `202 + jobId`，通过 SSE 推送进度。
3. 失败统一进入 Problem Details / Job Error，保留 `requestId`、`traceId` 和 checkpoint。

## 1. 角色、想法和 ArtProject

| 项目     | 定义                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| 输入     | 角色名；角色设定与参考图至少提供一种；创作要求选填；每个素材的用途/备注/权重                                         |
| 持久输出 | `Character`、`ArtProject`、`PromptInputSubmission`、初始 `PromptDraft`；用户提供或确认时生成 `CharacterBriefVersion` |
| 人工门禁 | 校验角色设定或参考图至少存在一种；用户确认已填写的 must / prefer / avoid 和素材角色                                  |
| 失败出口 | 文件失败不丢文字；要求未覆盖时阻止静默提交 PromptVersion                                                             |

```mermaid
flowchart TD
  A["创建 Character"] --> B["创建 ArtProject"]
  B --> C["同一流程：<br/>输入角色设定或上传参考图<br/>+ 可选创作要求/素材元数据"]
  C --> D["原子创建 PromptInputSubmission"]
  D --> E{"角色设定或参考图<br/>至少一种？"}
  E -->|失败| E1["字段级错误<br/>不创建 AI 任务"]
  E1 --> C
  E -->|通过| E2{"文件 MIME/hash<br/>与要求字段合法？"}
  E2 -->|失败| E1
  E2 -->|通过| F{"视觉/文本模型可用？"}
  F -->|是| G["多模态 Prompt Reverse Job<br/>同时读取角色设定、素材和可选要求"]
  F -->|否| H["模板 + 手工填写"]
  G --> I["PromptNormalizer"]
  H --> I
  I --> J["PromptQualityChecker<br/>+ Requirement Coverage Audit"]
  J -->|有问题| K["展示缺失、冲突、低置信度块"]
  K --> C
  J -->|通过| L["PromptDraft<br/>绑定 inputSubmissionId"]
  L --> M["提交 PromptVersion<br/>固化 PromptSpec、有序 references 和要求快照"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class E,K,M gate;
  class L artifact;
```

## 2. 提示词编辑、锁定与 AI 建议

| 项目     | 定义                                                     |
| -------- | -------------------------------------------------------- |
| 输入     | 当前 `PromptDraft`、用户修改、自然语言修改要求           |
| 持久输出 | 新 draft revision；用户采纳后可提交新 `PromptVersion`    |
| 人工门禁 | AI 建议必须由用户采纳，锁定块不可修改                    |
| 关键校验 | `baseContentHash`、目标 block 存在、lockAll/block.locked |

```mermaid
flowchart TD
  A["当前 PromptDraft"] --> B["用户逐块编辑"]
  B --> C["锁定身份/风格/禁止项"]
  C --> D{"保存草稿"}
  D -->|If-Match 冲突| D1["保留本地编辑<br/>提示刷新基线"]
  D -->|成功| E["新 DraftRevision"]

  E --> F["用户输入自然语言修改要求"]
  F --> G["AI Suggestion Job"]
  G --> H["模型输出结构化 operations"]
  H --> I{"base hash 仍一致？"}
  I -->|否| I1["PROMPT_BASE_STALE"]
  I -->|是| J{"命中锁定块？"}
  J -->|是| J1["PROMPT_BLOCK_LOCKED"]
  J -->|否| K["SuggestionDiff"]

  K --> L{"用户决定"}
  L -->|拒绝| M["保留原 draft"]
  L -->|继续修改| F
  L -->|采纳| N["生成新 DraftRevision"]
  N --> O{"用户保存版本"}
  O -->|否| E
  O -->|是| P["新 PromptVersion"]

  D1 --> D
  I1 --> D
  J1 --> F

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class C,L,O gate;
  class P artifact;
```

## 3. 生图、候选采纳、回退

| 项目       | 定义                                                                           |
| ---------- | ------------------------------------------------------------------------------ |
| 输入       | `PromptVersion`、可选 base ArtVersion；PromptVersion 内含有序 references       |
| 持久输出   | `GenerationCandidate`；采纳后生成只含最终图片的不可变 `ArtVersion`             |
| 人工门禁   | 用户必须采纳候选，AI 不自动成为当前版本                                        |
| 核心不变量 | PromptVersion 保存完整 PromptSpec 与 references；ArtVersion 只保存最终 artwork |

```mermaid
flowchart TD
  A["选择 PromptVersion"] --> B["创建 Generation Job"]
  B --> C["读取 PromptVersion<br/>PromptSpec + 有序 references"]
  C --> D{"includeBaseArtworkReference？"}
  D -->|是，且当前立绘尚未在 refs 中| D2["追加 active 立绘<br/>作为最后一张参考"]
  D -->|否| E["保持 PromptVersion references"]
  D2 --> F["Compile Prompt + Capability Profile"]
  E --> F
  F --> G["Provider Adapter"]
  G -->|失败| G1["Provider Error / RetryPolicy"]
  G1 -->|安全重试| B
  G1 -->|不可重试| G2["Job failed"]
  G --> H["候选图"]
  H --> I["尺寸、构图、hash、内容校验"]
  I -->|失败| I1["拒绝候选"]
  I -->|通过| J["Candidate Review"]
  J -->|继续生成| B
  J -->|放弃| K["保留当前 active"]
  J -->|采纳| L{"If-Match activeVersionId"}
  L -->|冲突| L1["ART_ACTIVE_VERSION_CHANGED"]
  L1 --> J
  L -->|成功| M["创建不可变 ArtVersion<br/>artwork asset + 生成来源"]
  M --> N["原子移动 active 指针"]
  N --> O["已有 Live2DProject 标记 stale"]

  P["历史 ArtVersion"] --> Q{"用户切换 active"}
  Q -->|回退| R["移动 active 指针<br/>记录 rolled_back"]
  R --> S["不修改当前 PromptVersion"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class J,L,Q gate;
  class M artifact;
```

### 3.1 PromptVersion 参考图管理

| 项目          | 定义                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| 集合结构      | 0..14 个参考图；API 每项含 assetId、role、note、weight、locked，数组顺序即优先级     |
| 主图          | 不定义业务主图；Provider 只支持单图时发送数组第一张并记录能力降级                    |
| 用户操作      | 增加、移除、排序、修改角色/备注/权重和锁定                                           |
| 版本约束      | PromptVersion 不可变；提示词或 references 任一变化都会创建新 PromptVersion           |
| ArtVersion    | 只保存 `artworkAssetId`，不复制或持有参考图                                          |
| Provider 规则 | 多图能力足够时发送全集；数量不足时发送数组前缀，其余记录 `reference_budget_exceeded` |

参考图关联同时进入引用计数。移除某个 PromptVersion 中的参考图不立即删除 Blob；其他版本、候选或分层记录仍可能引用同一个内容 hash。

### 3.2 从版本 Fork 子项目

| 项目     | 定义                                                       |
| -------- | ---------------------------------------------------------- |
| 输入     | 已提交 `PromptVersion` 或 `ArtVersion`、分支名、分支标签   |
| 持久输出 | 子 ArtProject、本地 seed versions、`ProjectFork`、审计事件 |
| 人工门禁 | 用户从版本节点主动 Fork；未保存草稿必须先提交              |
| 关系规则 | 同一 Character、固定源版本、可多 Fork、无自动 merge-back   |

```mermaid
flowchart TD
  A["父 ArtProject 版本树"] --> B{"选择 Fork 源"}
  B -->|提示词基线| C["PromptVersion"]
  B -->|立绘基线| D["ArtVersion"]
  C --> E{"版本已提交且 hash 有效？"}
  D --> E
  E -->|否| E1["FORK_SOURCE_UNCOMMITTED<br/>先保存版本"]
  E -->|是| F["填写子项目名 + branchLabel"]
  F --> G["POST /prompt-versions/:id/forks<br/>或 /art-versions/:id/forks"]
  G --> H{"Idempotency-Key 去重"}
  H -->|重复| I["返回已创建的子项目"]
  H -->|新请求| J["事务创建 child ArtProject"]
  J --> K["复制 seed PromptVersion<br/>+ 完整有序 references"]
  D --> L["复制 seed ArtVersion<br/>复用 artworkAssetId<br/>generationJobId=null"]
  K --> M["写入 ProjectFork<br/>root/parent/source"]
  L --> M
  M --> N["写 art_project.forked 审计"]
  N --> O["打开子项目工作台"]
  O --> P["项目列表按谱系树展示"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class B,E,F,H gate;
  class J,K,L,M artifact;
```

项目列表不把每个 Fork 当成独立根项目：

```text
银发少女
├─ 主项目 · active art v5
│  ├─ 蓝发冬季服 · from art v3
│  │  └─ 短发实验 · from art v4
│  ├─ 夏日礼服 · from art v3
│  └─ 配色实验 · from prompt v6
└─ 黑发实验线 · from art v2
```

根项目卡片显示分支数；子项目卡显示来源版本、分支标签、当前 active 和模型状态。搜索命中子项目时自动展开其祖先；父项目删除后子项目保留，并显示来源已删除。

## 4. Live2D 立绘准备

| 项目     | 定义                                                                                        |
| -------- | ------------------------------------------------------------------------------------------- |
| 输入     | 用户在立绘工作台最终确认的 ArtVersion、原始 PromptVersion、角色设定、目标身体范围和动作能力 |
| 持久输出 | `Live2DPreparationPromptVersion`、`Live2DReadyArtVersion`、主立绘和可选角色设定板           |
| 人工门禁 | 来源 ArtVersion 必须已确认；用户接受制作立绘候选后才能进入分层                              |
| 失败出口 | 背景、相近色或身体范围不合格时留在本页；允许上传已有分层用立绘                              |

```mermaid
flowchart TD
  A["用户最终确认的 ArtVersion"] --> B["展示来源版本和确认信息"]
  B --> C["适用性检查<br/>背景 / 相近色 / 姿态 / 手脚 / 画布"]
  C --> D["生成 Live2DPreparationPromptVersion"]
  D --> E["生成分层用立绘候选和可选角色设定板"]
  E --> F{"身份 / 背景 / 主体完整度验收"}
  F -->|不通过| D
  F -->|通过| G["用户接受"]
  G --> H["Live2DReadyArtVersion"]
  H --> I["解锁 Live2D 分层"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class B,C,F,G gate;
  class H artifact;
```

See-through 只读取 `Live2DReadyArtVersion.layerReadyArt`。Provider 顺序为生产默认的
`private_worker`、用户自带额度的 `hf_space`、以及无 GPU/无额度时的 `manual_psd`。公共 HF Space
的 ZeroGPU 配额错误必须停止重试，不能通过 Playwright 反复打开浏览器绕过。

## 5. Live2D 分层

| 项目     | 定义                                                          |
| -------- | ------------------------------------------------------------- |
| 输入     | `Live2DReadyArtVersion`，或用户直接提供 PSD                   |
| 持久输出 | `LayerSpecCandidate`；采纳后形成初始 `LayerSpecVersion`       |
| 默认实现 | See-through 私有 worker；可选 HF Space adapter；PSD 导入旁路  |
| 本页验收 | 单主体、必需语义、坐标、alpha、合成误差和 provider 结果一致性 |

```mermaid
flowchart TD
  A["Live2DReadyArtVersion"] --> B{"用户已有 PSD？"}
  B -->|是| C["PSD 导入与安全检查"]
  B -->|否| D{"选择 See-through Provider"}
  D -->|private_worker| E["异步 worker"]
  D -->|hf_space| F["Gradio queue"]
  D -->|manual_psd| C
  E --> G["PSD + manifest 规范化"]
  F --> G
  F -->|quota / schema / timeout| H["保留当前版本<br/>提供 worker / PSD 回退"]
  C --> I["图层树与合成预检"]
  G --> I
  I --> J{"本页验收"}
  J -->|不通过| K["留在 Live2D 分层<br/>重分层或返回立绘准备"]
  J -->|通过| L["用户采用初始 LayerSpecVersion"]
  L --> M["进入 PSD 图层工作台"]


  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class B,D,J gate;
  class G,L artifact;
```

## 6. Live2D PSD 图层工作台

| 项目     | 定义                                                              |
| -------- | ----------------------------------------------------------------- |
| 输入     | 当前 `LayerSpecVersion`、PSD、图层栈、像素选区、可选 AI 会话      |
| 人工能力 | 套索、魔棒、选区布尔、图层导入/替换/排序、合成与差异预览          |
| AI 能力  | 选区上下文 + 一次性脚本 + 沙箱执行 + OCR/视觉/像素断言 + 候选预览 |
| 持久输出 | 新 `LayerSpecVersion`、PSD、图层映射和本页验收结果                |
| 本页验收 | 像素/图层合法、pinned 未变、合成预演通过、PSD 可被 Binder 读取    |

```mermaid
flowchart TD
  A["当前 PSD 和 LayerSpecVersion"] --> B["用户在画布选区或调整图层"]
  B --> C{"需要 AI？"}
  C -->|否| D["本地 PSD 操作与撤销"]
  C -->|是| E["携带选区、图层、pinned 和对话"]
  E --> F["OCR / 视觉分析"]
  F --> G["任务临时区生成一次性脚本"]
  G --> H["隔离沙箱执行"]
  H --> I["OCR / 像素 / 合成断言"]
  I -->|失败一次| G
  I -->|通过| J["前后预览和修改卡片"]
  D --> K["本页验收"]
  J -->|用户接受| K
  K -->|不通过| B
  K -->|通过| L["新 LayerSpecVersion"]
  L --> M["Live2D 绑定与交付"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class C,I,K gate;
  class L artifact;
```

AI 脚本只存在应用任务临时目录。仓库、LayerSpecVersion 和桌宠交付包只保存结构化 manifest、
输入 hash 与验收证据。

## 7. Live2D 绑定与交付

| 项目        | 定义                                                           |
| ----------- | -------------------------------------------------------------- |
| 输入        | `LayerSpecVersion`、BindingReadyPsd、RigPlan、目标 Cubism 版本 |
| 默认 Binder | PSD2Live，应用管理的隔离进程/MCP                               |
| 持久输出    | Binder 工程快照、模型文件族、新 `RigPlanVersion`、预览验收     |
| 默认模式    | `co-drive`：AI 先做可见效果预览，用户采用后才提交              |
| 安全边界    | 受控 `rig.*` 工具、approval proof、CAS                         |

```mermaid
sequenceDiagram
  actor U as 用户
  participant UI as Rig Workbench
  participant API as RigCopilotService
  participant AI as Studio Agent
  participant MCP as PSD2Live MCP
  participant QA as 本页验收

  U->>UI: 选中图层/参数并输入“闭眼穿模，帮我修”
  UI->>API: 创建 copilot session + selection
  API->>MCP: get_context / inspect_objects
  MCP-->>API: stateHash、对象、参数、诊断
  API->>AI: 请求结构化修绑提案
  AI-->>API: RigEditProposal
  API->>API: Schema / 对象范围 / 锁定规则校验
  API->>MCP: preview_proposal
  MCP-->>API: 候选状态 + 诊断
  API->>API: 渲染标准参数探针
  API-->>UI: 可交互 before/after<br/>“修好了什么” + 简版影响说明
  UI-->>U: 先看效果；技术 diff 折叠
  alt 用户要求继续修改
    U->>UI: “闭眼幅度再小一点”
    UI->>API: refine proposal
    API->>AI: 基于诊断重新提案
  else 用户采用
    U->>UI: 点击“采用这个效果”
    UI->>API: approvalProof + proposalId
    API->>MCP: CAS apply atomic edits
    MCP-->>API: new state + history node
    API->>API: 保存 Binder snapshot + RigPlanVersion
    API->>QA: rebuild + 本页验收
    QA-->>API: pass / fail
    API-->>UI: applied + “撤销这次修改”
  else 用户拒绝
    U->>UI: 点击“拒绝”
    UI->>API: reject
    API-->>UI: 保留正式工程
  end
```

AI 预览失败最多自动修正 3 次；应用阶段不允许模型自行追加新操作。

采用后的回退：

```text
新 RigPlanVersion
  → 重建 ModelBuild
  → 本页验收
  → 用户点击“撤销这次 AI 修改”
  → active RigPlan/ModelArtifact 指回上一个版本
  → 旧版本仍可查看和再次采用
```

## 8. 阶段验收与桌宠交付

| 项目     | 定义                                                               |
| -------- | ------------------------------------------------------------------ |
| 输入     | 当前阶段候选、本页验收结果、来源版本和用户确认                     |
| 持久输出 | 阶段验收记录、新版本、最终 `ModelArtifact`                         |
| 阻塞规则 | 当前页阻塞项未清空时禁止进入下一步                                 |
| 交付规则 | 只有 `handoff_ready` 的绑定产物可以交给桌宠，状态转为 `handed_off` |

```mermaid
flowchart TD
  A["当前工作台候选"] --> B["本页验收"]
  B --> C{"阻塞项已清空？"}
  C -->|否| D["留在当前页<br/>定位图层/参数/选区"]
  D --> A
  C -->|通过立绘准备| E["创建 Live2DReadyArtVersion"]
  C -->|通过分层| F["创建初始 LayerSpecVersion"]
  C -->|通过 PSD 图层| G["进入 Live2D 绑定与交付"]
  C -->|通过绑定| H["ModelBuild + handoff_ready"]
  H --> I{"用户点击“交给桌宠”"}
  I -->|否| J["保留当前版本，不上报全局返工"]
  I -->|是| K["事务绑定 Pet.active_model_id"]
  K --> L["handed_off"]
  L --> M["桌宠热加载 / 提示重启"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class C,B,I gate;
  class H,L artifact;
```

## 9. 外部模型导入与桌宠启动

| 项目     | 定义                                                   |
| -------- | ------------------------------------------------------ |
| 输入     | 标准 Live2D 目录或 zip                                 |
| 持久输出 | `ModelArtifact`、来源与许可元数据、Pet runtime binding |
| 安全门   | zip-slip、解压炸弹、MIME、引用逃逸、sandbox 加载       |

```mermaid
flowchart TD
  A["选择目录 / zip / HTTPS 包"] --> B["下载或复制到 staging"]
  B --> C{"大小、数量、压缩比限制"}
  C -->|失败| C1["ARCHIVE_LIMIT_EXCEEDED"]
  C -->|通过| D["安全解压 + zip-slip 检查"]
  D --> E["寻找 model3/model 入口"]
  E -->|未找到| E1["MODEL_ENTRY_NOT_FOUND"]
  E -->|找到| F["引用、MIME、路径、moc 版本校验"]
  F -->|失败| F1["MODEL_REFERENCE_INVALID"]
  F -->|通过| G["Sandbox Renderer 加载测试"]
  G -->|失败| G1["MODEL_RUNTIME_INCOMPATIBLE"]
  G -->|通过| H["记录来源、版权、hash"]
  H --> I["原子移入模型库"]
  I --> J["用户绑定 Pet 与 Persona"]
  J --> K["生成 runtime manifest"]
  K --> L["Pet Renderer 加载模型"]
  L --> M["MotionResolver 绑定 idle/tap/thinking 等意图"]
  M --> N["透明窗口 + 点击穿透状态机"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class C,E,F,G,J gate;
  class H,K artifact;
```

## 10. Direct LLM 聊天与全量记忆

| 项目     | 定义                                       |
| -------- | ------------------------------------------ |
| 输入     | 用户消息、PersonaVersion、当前模型记忆空间 |
| 持久输出 | Messages、会话摘要、MemoryItem             |
| 记忆规则 | 对话与长期记忆均由桌宠管理                 |
| 失败降级 | 流中断保留已收文本；记忆任务失败不回滚聊天 |

```mermaid
sequenceDiagram
  actor U as 用户
  participant P as Pet UI
  participant C as ChatService
  participant M as MemoryService
  participant L as LLM Provider
  participant J as Memory Job

  U->>P: 发送消息
  P->>C: POST /chat/turns
  C->>M: retrieve(spaceId, query)
  M-->>C: facts + recent summaries
  C->>C: compile persona + memory + history
  C->>L: stream turn
  L-->>C: text/action deltas
  C-->>P: SSE deltas + motion intent
  alt 用户停止
    P->>C: cancel turn
    C-->>P: cancelled, 保留已显示文本
  else 正常完成
    C->>C: persist messages
    C->>J: enqueue memory extraction
    J->>J: extract → dedupe → embed → conflict check
    J-->>M: upsert MemoryItem
  else Provider 失败
    C-->>P: normalized ProblemDetails
    C->>C: 保存已确认的部分消息，标记 turn failed
  end
```

## 11. Forward 聊天与零持久记忆

| 项目     | 定义                                                     |
| -------- | -------------------------------------------------------- |
| 输入     | 用户消息、`external_only` Forward 配置、opaque sessionId |
| 持久输出 | 仅 transport metrics；不写 Conversation、Message、Memory |
| 显示状态 | 当前 turn 只在 renderer 临时状态或 sidecar ring buffer   |
| 失败规则 | 不自动重发有副作用的请求                                 |

```mermaid
sequenceDiagram
  actor U as 用户
  participant P as Pet UI
  participant C as ForwardAdapter
  participant A as 用户自建 AI

  U->>P: 发送消息
  P->>C: transient turn
  C->>C: 校验 external_only policy
  C->>A: 渲染模板后的 HTTP 请求
  A-->>C: JSON / text / NDJSON / SSE
  C->>C: textPath 白名单提取
  C-->>P: stream/bubble
  P-->>U: 显示回复，不进入 IndexedDB/记忆
  Note over C,A: 最近 turn 只存在内存 ring buffer
  Note over C: 禁止调用 ConversationRepository / MemoryWriter / MemoryRetriever
```

Forward 的异常：

- `FORWARD_TEMPLATE_INVALID`：设置页修正。
- `FORWARD_RESPONSE_PATH_MISSING`：设置页修正。
- `PROVIDER_TIMEOUT`：显示失败，不自动重试有副作用的 POST。
- `SEC_SSRF_BLOCKED`：不发起请求，记录安全审计。

## 12. Codex / Claude Agent

### 12.1 代班执行

| 项目     | 定义                                               |
| -------- | -------------------------------------------------- |
| 输入     | Agent provider、cwd、任务、权限模式                |
| 持久输出 | `agent_task` 元数据 + `agent_task_projection` 摘要 |
| 工作记忆 | Codex/Claude 原生 thread/session 管理              |
| 桌宠记忆 | 只保存目标、完成度、当前摘要、阻塞项               |

```mermaid
sequenceDiagram
  actor U as 用户
  participant P as Pet Agent UI
  participant H as Agent Supervisor
  participant A as Codex App Server / Claude SDK
  participant W as 用户 Workspace
  participant M as Summary Projection

  U->>P: “修复这个测试失败”
  P->>H: create agent task + provider + cwd + permission
  H->>A: start/resume session + turn
  A->>W: 读取文件/编辑/运行命令
  alt 需要权限
    A->>H: approval.requested
    H-->>P: approval UI（命令/diff/scope）
    U->>P: accept/decline
    P->>H: decision + scope_hash
    H->>A: resolve approval
  end
  A-->>H: deltas / tools / diff / plan events
  H-->>P: normalized AgentEvent + motion intent
  A-->>H: turn.completed / turn.failed
  H->>M: extract task checkpoint from final visible result
  M-->>H: summary/completion/blockers
  H->>H: persist projection only
  P-->>U: 气泡摘要 + 模型动作
```

### 12.2 跟随外部会话

```mermaid
flowchart LR
  A["Codex/Claude 外部 CLI/IDE"] --> B["Hooks"]
  B --> C["本地 Hook endpoint<br/>token + schema + dedupe"]
  C --> D["EventNormalizer"]
  D --> E["AgentEvent ring buffer"]
  E --> F["Pet bubble / motion / approval"]
  C -->|桌宠离线/超时| G["快速返回，不阻塞宿主"]
  D -->|默认| H["不持久化正文"]
  D -->|Stop 摘要| I["TaskProjection<br/>仅摘要与完成度"]
```

Agent 原始事件不写入桌宠记忆。完整 thread、工具轨迹和 diff 由 Codex/Claude 自身保存；桌宠通过 native session ref 恢复或重新打开。

## 13. 桌宠 AI 工具、MCP 与 Skills

| 项目     | 定义                                                          |
| -------- | ------------------------------------------------------------- |
| 输入     | 用户问题、当前时间/时区、Pet/Model 工具授权、MCP 工具、Skills |
| 持久输出 | ToolInvocation 元数据、来源引用、Tool/Skill 授权              |
| 默认工具 | `clock.now`、`calc.eval`、`system.get_context`                |
| 联网工具 | `web.search`、`web.fetch`，默认关闭                           |
| 扩展入口 | 本地/远程 MCP、Skill 目录或 zip                               |

### 13.1 Direct AI 工具循环

```mermaid
sequenceDiagram
  actor U as 用户
  participant P as Pet Chat
  participant C as ContextBuilder
  participant L as LLM
  participant G as Tool Gateway
  participant T as Built-in / MCP / Skill

  U->>P: “今天上海天气怎么样？”
  P->>C: 创建本轮上下文
  C->>C: 注入当前日期、时间、时区
  C-->>L: persona + memory + current time
  L->>G: web.search(“上海天气”)
  G->>G: 检查 Pet 授权、Schema、网络开关
  alt 需要确认
    G-->>P: 工具调用确认卡
    U->>P: 允许本次 / 本会话
    P->>G: approval
  end
  G->>T: 执行搜索
  T-->>G: 标题、URL、摘要、retrievedAt
  G-->>L: trust=untrusted + 来源
  L-->>P: 带来源的回答 + action intent
  P-->>U: 气泡 + 动作 + 引用链接
  G->>G: 写调用元数据和审计
```

没有搜索工具时，模型仍能正确知道当前日期，因为每轮上下文都会注入系统时间；需要精确时间时调用 `clock.now`。

### 13.2 MCP 添加与授权

```mermaid
flowchart TD
  A["设置 → AI 工具 → MCP"] --> B["添加 stdio 命令或 HTTPS URL"]
  B --> C["安全扫描 / 连接测试"]
  C -->|失败| C1["显示握手、鉴权或网络错误"]
  C -->|成功| D["MCP initialize + tools/list"]
  D --> E["校验 input/output Schema"]
  E --> F["按风险分类工具"]
  F --> G["用户查看工具清单与权限"]
  G --> H["为每个 Pet 设置 deny/ask/session/always"]
  H --> I["保存 schemaHash + grant"]
  I --> J["工具可被 Direct AI 调用"]
  J --> K["MCP 更新后 schemaHash 变化"]
  K --> L["pending_reapproval<br/>暂停工具"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class C,G,H,L gate;
  class I artifact;
```

### 13.3 Skill 安装与启用

```mermaid
flowchart TD
  A["选择 Skill 目录 / zip"] --> B["解析 SKILL.md + manifest.json"]
  B --> C{"格式、文件清单、hash 校验"}
  C -->|失败| C1["SKILL_INVALID"]
  C -->|通过| D["预览说明、作者、版本、依赖工具"]
  D --> E{"用户确认安装？"}
  E -->|否| F["不写入"]
  E -->|是| G["安装 SkillVersion"]
  G --> H["为 Pet 启用并授予 scopes"]
  H --> I["按需加载 instructions/references"]
  I --> J{"需要脚本？"}
  J -->|否| K["进入模型上下文"]
  J -->|是| L["要求用户授权 Sandbox Runner"]
  L -->|拒绝| M["Skill 仍可作为纯文本指导"]
  L -->|允许| N["受控执行脚本工具"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  C,E,H,J,L gate;
  class G artifact;
```

### 13.4 工具调用与记忆边界

| 情况              | 行为                                                 |
| ----------------- | ---------------------------------------------------- |
| Direct + 工具结果 | 可以形成消息上下文；长期事实需经过记忆提取与来源标注 |
| Forward           | 不调用桌宠工具，外部 AI 自行管理工具和记忆           |
| Agent             | 编码工具归 Codex/Claude；桌宠只保存任务投影          |
| 搜索/网页正文     | 标记为不可信外部内容，不自动写入长期记忆             |
| Skill 指令        | 只影响当前启用 Pet/Model，不覆盖安全策略             |
| MCP/Skill 升级    | Schema 或 manifest hash 变化后暂停，重新授权         |

## 14. 横切错误、取消与恢复

| 项目     | 定义                                                    |
| -------- | ------------------------------------------------------- |
| 输入     | 任意 HTTP、Job、Provider、Agent 或 Binder 异常          |
| 持久输出 | ProblemDetails、JobError、日志、审计、checkpoint        |
| 用户出口 | 修正输入、刷新、重试、切换 Provider、重新审批或联系支持 |
| 核心规则 | 有副作用或结果未知时禁止自动重放                        |

```mermaid
flowchart TD
  A["异常发生"] --> B["Adapter 归一化"]
  B --> C["Error Registry 查表"]
  C --> D{"已知业务错误？"}
  D -->|是| E["ProblemDetails / JobError"]
  D -->|否| F["SYS_INTERNAL + causeId"]
  E --> G{"副作用是否已发生且结果未知？"}
  F --> G
  G -->|是| H["unknown_outcome<br/>不自动重试"]
  G -->|否| I{"retryable 且安全？"}
  I -->|是| J["指数退避 + jitter"]
  I -->|否| K["返回用户可操作错误"]
  J --> L{"达到最大次数？"}
  L -->|否| M["重试同一 job / request"]
  L -->|是| K
  H --> N["用户检查产物/外部状态"]
  K --> O["UI 错误状态<br/>保留未提交编辑"]
  E --> P["结构化日志"]
  E --> Q["关键操作写审计"]
  F --> P
  N --> R["确认成功 / 重跑 / 放弃"]
```

### 任务恢复

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> leased
  leased --> running
  running --> succeeded
  running --> failed
  failed --> retrying: retryable + safe
  retrying --> leased
  running --> waiting_user
  waiting_user --> running: user resolves
  waiting_user --> cancelled
  running --> cancelled
  running --> unknown_outcome: side effect uncertain
  unknown_outcome --> succeeded: user confirms
  unknown_outcome --> failed: user rejects
  succeeded --> [*]
  failed --> [*]
  cancelled --> [*]
```

## 15. 一次完整成功链路

```mermaid
flowchart TD
  A["想法/设定"] --> B["PromptVersion"]
  B --> C["生成候选"]
  C --> D["用户采纳 ArtVersion v1"]
  D --> E["Live2D 立绘准备"]
  E --> F["See-through 分层"]
  F --> G["PSD 图层工作台<br/>局部修复与合成预演"]
  G --> H["PSD2Live 绑定"]
  H --> I["AI 对话修绑"]
  I --> J["用户预览并应用"]
  J --> K["重建 ModelBuild"]
  K --> L["Live2D 绑定页验收"]
  L --> M["交给桌宠<br/>ModelArtifact + handoff_ready"]
  M --> N["Pet 绑定 Persona"]
  N --> O["Direct / Forward / Agent"]
  O --> P["任务摘要 / 记忆按模式处理"]
  P --> Q["桌宠气泡 + 动作反馈"]

  classDef gate fill:#8d6a36,color:#fff,stroke:#6d4f24;
  classDef artifact fill:#286a63,color:#fff,stroke:#1d514b;
  class D,I,J,L,M,Q gate;
  class E,G,K,N artifact;
```

## 16. 各阶段必须留下的可审计产物

| 阶段             | 必须持久化                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| 想法与提示词     | PromptInputSubmission、PromptSpec、PromptVersion references、锁定状态、CharacterBriefVersion（如有）、AI 建议     |
| Fork             | child/parent/root project、source version + hash、branchLabel、seed Prompt/ArtVersion、审计事件                   |
| 生图             | PromptVersion、可选 base ArtVersion、编译 Prompt、references hash、Provider 请求摘要、候选、active 指针           |
| 立绘准备         | 已确认 ArtVersion、Live2DPreparationPromptVersion、主立绘、角色设定板、适用性检查和验收                           |
| 分层             | Live2DReadyArtVersion、See-through provider/版本/参数、PSD/manifest、LayerSpecVersion、本页验收                   |
| PSD 图层         | 输入图层、选区、pinned、AI manifest、前后预览、BindingReadyPsd assetId/hash、本页验收                             |
| 绑定             | ArtVersion、LayerSpecVersion、BindingReadyPsd、RigPlanVersion、CanvasTransform、Binder 版本、工程快照、ModelBuild |
| AI 修绑          | 选区、proposal、baseStateHash、preview、approval proof、apply 结果                                                |
| 桌宠交付         | Core/runtime 版本、ModelArtifact、`handed_off_at`、`handoff_target=pet`、交付审计                                 |
| Direct           | Messages、记忆抽取状态、MemoryItem                                                                                |
| Forward          | 仅 transport metrics 和错误码；不保存正文                                                                         |
| Agent            | native session ref、状态、任务投影摘要、审批审计                                                                  |
| Tools/MCP/Skills | source、tool schema hash、grant、invocation hash、来源与检索时间                                                  |
| 错误与恢复       | requestId/traceId、错误码、attempt、checkpoint、unknown_outcome 结论                                              |
