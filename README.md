# agent2live

本地优先的"角色创作与运行套件"：从想法、设定或参考图出发，经过可控的提示词与立绘版本链，制作成可绑定的 PSD 与 Live2D 模型，最终交给桌宠运行——人格、聊天、记忆与 Agent 接入。

```text
想法 / 素材
  → 颗粒化提示词草稿
  → 图片候选
  → 用户采纳的不可变立绘版本
  → Live2D 立绘准备与 See-through 分层
  → 可编辑 PSD
  → 绑定计划与实时预体验
  → Live2D 模型构建
  → 交给桌宠
  → 人格、聊天、记忆与 Agent 接入
```

> 状态：早期开发中（v0.1.0）。当前为**单用户、单机、单本地工作区**的个人工作台，不是多用户 SaaS（见 [ADR 0006](docs/decisions/0006-single-user-workspace.md)）。

## 产品理念

### 三个解耦的制作子系统

角色是贯穿全链路的主实体，但三个制作子系统必须解耦——立绘管理不是生图聊天页，Live2D 管理不是通用图层编辑器，桌宠也不是把前两者塞进一个透明窗口。

### 自动 / AI 辅助 / 人工兜底

"链路完全走通"不等于"每个生成步骤都全自动"。每项能力都分三档并保证有明确出口：

| 能力             | 自动                       | AI 辅助                      | 人工兜底                   |
| ---------------- | -------------------------- | ---------------------------- | -------------------------- |
| 参考图逆向提示词 | 结构化提取                 | 视觉模型分析 + 置信度        | 用户直接填写各颗粒块       |
| 立绘生成         | 生图 API                   | 候选图人工采纳               | 用户上传自己的立绘         |
| 分层             | See-through 私有 worker    | HF Space 或 PSD 候选审查     | 用户上传 PSD               |
| PSD 图层         | 自动合成预演               | 选区、局部修复和前后候选     | 画布手工修层               |
| Live2D 绑定      | PSD2Live 实时预览          | 参数、物理、动作和对话式修绑 | 导入外部模型或专业工具产物 |
| 聊天             | 原生模型、HTTP 转发、Agent | 提示词和动作意图建议         | 仅显示状态或关闭聊天       |

两条底线：

1. 用户上传一张立绘和一个合格 PSD、本地 Binder 可用时，可以生成桌宠能加载的模型，**不依赖任何生成式 AI**。
2. 任何一个云端 AI Provider 失败，只降级对应能力，**不阻断**项目读取、版本回滚、模型预览和桌宠运行。

### 版本不可变，AI 永不直写

已采纳的立绘版本、提示词版本和模型构建都不可变——修正是创建新版本。AI 的所有修改（逆向提示词、建议、生图、修层、修绑）都先落为**候选**，经用户审查接受后才进入正式版本链；用户锁定的颗粒块 AI 只能建议、不能覆盖。

## 制作产线：四段工作台

Live2D 制作链路收敛为四个用户可理解的工作台，每段自带验收与放行条件：

| 工作台         | 用户问题                             | 出口                                        |
| -------------- | ------------------------------------ | ------------------------------------------- |
| 立绘准备       | 最终立绘能否稳定地变成可分层输入？   | 生成 `Live2DReadyArtVersion`                |
| 分层           | 分层用立绘是否已变成合格的初始图层？ | 图层完整、合成通过，生成 `LayerSpecVersion` |
| PSD 图层工作台 | 图层归属和局部画面是否正确？         | PSD 与局部修改验收通过，进入绑定            |
| 绑定与交付     | 动起来是否成立、是否像这个角色？     | 体验验收通过，交给桌宠系统                  |

工作台规范见 [Live2D 四段工作台架构](docs/architecture/2026-11-26-live2d-four-stage-workbench.md)。

## 架构

桌面壳内嵌一个本地 sidecar 服务，全部数据留在本机：

```text
┌────────────────────────── Electron 桌面壳 ──────────────────────────┐
│  Studio 窗口（React）        Pet 窗口（透明桌宠）                     │
│        │  Bearer token + SSE          │                              │
│        ▼                              ▼                              │
│  ┌─────────────────── utilityProcess ───────────────────┐            │
│  │  Fastify sidecar（127.0.0.1）                        │            │
│  │  · REST /api/v1 + SSE 事件流                         │            │
│  │  · SQLite WAL（元数据）+ 内容寻址 Blob Store          │            │
│  │  · 持久化 Job 队列（AI 调用一律异步 202 + job）        │            │
│  │  · Provider 适配（Chat / Image / Vision / See-through）│           │
│  └──────────────────────────────────────────────────────┘            │
│        ▲ secrets（Electron safeStorage vault，DB 只存 secret_ref）    │
└──────────────────────────────────────────────────────────────────────┘
```

| 层          | 选择                                             |
| ----------- | ------------------------------------------------ |
| 桌面壳      | Electron + React 18 + TypeScript + electron-vite |
| 前端状态    | Vite + React Router + TanStack Query + Zustand   |
| 本地后端    | Node.js + Fastify，独立 sidecar 进程             |
| 跨端契约    | TypeScript 类型 + Zod Schema + JSON Schema 导出  |
| 本地数据库  | SQLite WAL + sqlite-vec（向量检索）              |
| 文件资产    | 内容寻址 Blob Store（`sha256` 为键，天然去重）   |
| Live2D 渲染 | PixiJS 7 + pixi-live2d-display-lipsyncpatch      |
| PSD 处理    | `ag-psd` + `sharp`（Node worker 内完成）         |
| 后台任务    | SQLite `jobs` 表 + 进程内持久任务调度器          |
| 实时通道    | SSE + HTTP 命令                                  |
| Agent 接入  | Codex App Server over stdio；Claude Agent SDK    |
| 自动绑定    | PSD2Live（GPL-3.0，独立进程 / MCP 接入）         |

## 仓库结构

```text
apps/
  desktop/    Electron 桌面壳（Studio 工作台 + Pet 桌宠窗口 + sidecar 拉起）
  server/     Fastify sidecar 本地服务（REST/SSE、任务、生成编排、SQLite）
packages/
  contracts/      跨端契约：Zod Schema + DTO 唯一事实源
  design-system/  无业务语义的共享组件库与设计 token
  live2d-runtime/ 统一 Live2D Runtime 封装（Studio 与桌宠同核心）
  logging/        结构化日志
  providers/      AI Provider 适配（OpenAI 兼容 Chat / Seedream 生图 / Mock）
docs/
  architecture/   架构基线与各子系统设计
  decisions/      ADR 决策记录
  api/            OpenAPI 文档
e2e/          Playwright E2E（驱动真实 Electron，视觉基线）
scripts/      质量门、AST 代码风格检查、打包、证据收集
spikes/       可行性验证原型（Codex/Claude probe、PSD2Live 等）
```

## 快速开始

### 环境要求

- Node.js `>=22 <23`
- pnpm `11.25.0`（`corepack enable` 后自动使用）
- macOS / Windows（Live2D 视觉一致性以 Chromium 渲染为准）

### 安装

```bash
pnpm install
```

### 安装 Cubism Core（渲染必需）

Cubism Core 不进入仓库和发行包，需从 [Live2D 官方](https://www.live2d.com/sdk/download/web/) 下载后本地安装：

```bash
CUBISM_CORE_SOURCE=/path/to/live2dcubismcore.min.js node scripts/install-cubism-core.mjs
```

不涉及 Live2D 渲染的开发（契约、server、提示词工作台）可以跳过这一步。

### 开发运行

```bash
pnpm dev        # 先构建 server，再并行启动 sidecar（watch）与 Electron
```

默认全部走 **Mock 模式**（确定性离线 mock，见 `packages/providers/src/mock.ts`），不需要任何 API Key，E2E 也基于它运行。

### 接入真实 AI Provider（可选）

复制 `.env.example` 为 `.env` 并按注释填写，支持：

- **DeepSeek Chat**（OpenAI 兼容）——提示词逆向与建议
- **Seedream 生图**（火山方舟）——立绘候选生成
- **Zhipu 视觉（GLM）**——参考图反推
- **See-through 分层 worker**——可选私有 worker / HF Space

配置好后可用 `pnpm test:real-providers` 跑真实 Provider 冒烟。

### 常用命令

```bash
pnpm typecheck         # 全仓类型检查
pnpm test              # Vitest 单元测试
pnpm test:e2e          # Playwright E2E（真实 Electron + mock provider）
pnpm format            # Prettier 格式化
pnpm check             # 完整质量门：format + AST 代码风格 + typecheck + test + gate
pnpm build             # 构建全部 workspace 包
pnpm pack:desktop      # 打包桌面端
pnpm api:openapi       # 生成 / 校验 OpenAPI 文档
```

## 文档

- [技术方案总览（架构基线）](docs/architecture/2026-11-06-idea-to-desktop-pet.md)
- [Live2D 四段工作台架构](docs/architecture/2026-11-26-live2d-four-stage-workbench.md)
- [UI 系统与通用组件库](docs/architecture/2026-11-12-ui-system.md)
- [数据模型](docs/architecture/2026-11-08-data-model.md) · [阶段工作流](docs/architecture/2026-11-08-stage-workflows.md) · [工具契约](docs/architecture/2026-11-08-tool-contracts.md)
- [ADR 决策记录](docs/decisions/)
- [已验证版本清单](docs/versions.md)

## 第三方边界

- `moc3` 是 Cubism 专有格式，不逆向编辑其二进制内部网格；绑定微调作用于绑定计划与可编辑资产后重新构建。
- Cubism Core 与 SDK 许可独立于本项目，发行前需按 Live2D 当前条款确认适用范围。
- PSD2Live 为 GPL-3.0 独立进程；See-through 源码 Apache-2.0，但其模型权重按权重发布页许可单独处理。

## 许可证

[GPL-3.0-only](LICENSE)。各子依赖保留自己的许可证与声明；主项目采用 GPL-3.0-only 以避免闭源产品集成 GPL Binder 时的分发歧义。
