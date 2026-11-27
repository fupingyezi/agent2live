# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

agent2live 是本地优先的"角色创作与运行套件"：提示词 → 立绘版本 → PSD 分层 → Live2D 模型 → 桌宠。当前为单用户、单机、单本地工作区（ADR 0006），不是多用户 SaaS。

产品与技术文档全部使用中文（`docs/architecture/`、`docs/decisions/`），用户可见文案为 zh-CN。提交信息使用 Conventional Commits 带 scope（如 `feat(workbench): ...`、`fix(prompt): ...`）。

## 常用命令

```bash
pnpm install                  # Node >=22 <23，pnpm 11（corepack）
pnpm dev                      # 先构建 server，再并行启动 sidecar（watch 模式）与 Electron
pnpm typecheck                # 全仓类型检查（workspace + root + e2e + spikes）
pnpm test                     # Vitest 单元测试（node 项目 + design-system 项目）
pnpm test <文件路径>           # 运行单个测试文件，如 pnpm test packages/contracts/src/prompt.test.ts
pnpm test:e2e                 # Playwright E2E（真实 Electron + mock provider，workers=1）
pnpm test:e2e workbench.spec.ts   # 运行单个 E2E spec
pnpm test:real-providers      # 真实云 Provider 冒烟（可选，需 .env 配置）
pnpm format                   # Prettier 格式化；format:check 只检查
pnpm check:code-style         # 自研 AST 代码风格检查（见下方"强制代码风格"）
pnpm token:lint               # 设计 token 检查（无裸色值等）
pnpm check                    # 完整质量门：format + code-style + typecheck + test + gate
pnpm build                    # 构建全部 workspace 包
pnpm api:openapi              # 生成 / 校验 docs/api/openapi.json
pnpm native:electron          # 为 Electron 重编原生模块（better-sqlite3 等）
```

Cubism Core 由用户本地提供、永不入库：`CUBISM_CORE_SOURCE=/path/to/live2dcubismcore.min.js node scripts/install-cubism-core.mjs`。

小改动验证到 typecheck / prettier / 相关单测为止，不要求跑 E2E。

## 架构

### 整体形态

pnpm monorepo：Electron 桌面壳（`apps/desktop`）+ Fastify sidecar 服务（`apps/server`）+ 共享包（`packages/*`）。**没有独立后端进程管理器**——sidecar 由 Electron main 作为 utilityProcess 拉起。

### Sidecar 启动与鉴权握手

关键文件：`apps/desktop/src/main/sidecar.ts`、`apps/server/src/index.ts`、`apps/server/src/endpoint.ts`、`apps/desktop/src/renderer/shared/http/client.ts`。

1. Electron main 启动 sidecar（utilityProcess，运行 `apps/server/dist/index.cjs`），传入 `AGENT2LIVE_DATA_DIR`。
2. Server 监听 `127.0.0.1`，自己生成 32 字节随机 token，原子写入 `<dataDir>/runtime/endpoint.json`（`{baseUrl, token, pid}`，mode 0600）。
3. Main 轮询读取 endpoint.json（zod 校验），renderer 通过 preload bridge `window.agent2live.getLocalServiceInfo()` 拿到。
4. 所有 HTTP 请求带 `authorization: Bearer <token>`；server 用 constant-time 比对。`/health` 也受保护。
5. Secrets 反向流动：sidecar 通过 utilityProcess parentPort 发 `secret.request`，main 从 Electron safeStorage vault 解析；数据库只存 `secret_ref`。

### Server 请求流（apps/server/src）

- `index.ts`（组装根）→ `app.ts`（Fastify wiring + auth hook + 错误处理）→ `routes/*.ts` → `services/*.ts`。
- **DI 为手写构造注入**：`services/container.ts:createServices()` 按依赖序实例化全部服务；route 只接收所需服务。
- Route 输入用 `@agent2live/contracts` 的 zod schema 校验，**不要在 route 里内联定义 schema**。
- 错误：任何地方 throw `AppError('<CODE>', details)`，统一转 RFC 7807 `ProblemDetails`（`application/problem+json`）。
- 数据库：better-sqlite3 + WAL + sqlite-vec，**无 ORM**；迁移是 `apps/server/migrations/` 下的纯 SQL 文件（`db/migrate.ts` 顺序应用）。
- 并发控制：`if-match` ETag + `idempotency-key` header（`routes/helpers.ts`、`services/idempotency.ts`）。
- Blob store：内容寻址 `<dataDir>/blobs/sha256/`，tmp+rename 写入；同一 sha256 全库只有一条 assets 行（去重 + provenance）。

### 后台任务（强不变量）

`jobs/engine.ts` 是 SQLite 持久化任务队列（250ms 轮询、5 分钟租约、可恢复）。**"让 AI 做事"的 route 只创建 job 并返回 202 + jobId，绝不在 HTTP 请求内同步调用模型**（ADR 0005）。

### 事件与 SSE

领域事件持久化在 SQLite（单调 `seq`），与业务写操作同事务缓冲、提交后通知。`GET /api/v1/events` 为 SSE（支持 `after=<seq>` / `Last-Event-ID` 重放）。Renderer 侧由 SSE 事件驱动 TanStack Query 缓存失效（`studio/api/invalidation.ts`、`hooks/useServerEvents.ts`）。

### 共享契约（packages/contracts）

zod schema + DTO 唯一事实源。包 `exports` **直接指向 TS 源码**（`./src/api.ts` 等），无构建步骤；server 用 tsup `noExternal` 打进单 `.cjs`，desktop 由 electron-vite 打包。API 版本固定 `/api/v1`。

注意 zod 版本：apps/packages 内用 **zod 3.25**，根 devDeps 的 zod 4 仅供 agent probe 脚本使用；server 按错误 `.name` 跨副本识别 ZodError。

### Renderer（apps/desktop/src/renderer）

两个入口：`studio/`（工作台主窗口）与 `pet/`（透明桌宠窗口，`AGENT2LIVE_OPEN_PET=1` 才开）。页面在 `studio/routes/<Name>Page/`，路由集中在 `studio/App.tsx`；提示词工作台在 `studio/workbench/`（Zustand draft store + TanStack Query）。

导入别名（`tsconfig.paths.json`，由 `check-module-boundaries.mjs` 强制）：

- `@desktop/shared`、`@renderer/*`、`@studio/api|components|hooks|providers|routes|workbench`
- studio 各模块（api/components/hooks/providers/routes/workbench）之间只能通过这些 barrel 别名互相导入，**禁止相对路径跨模块导入、禁止别名深路径导入**（`@studio/api/foo` 不行）。
- **Electron main/preload 禁止导入任何 renderer 代码**。

### design-system 边界

`packages/design-system` 是无业务语义的组件库：不依赖 contracts、Electron、TanStack Query、Zustand；不含领域类型（ArtVersion 等）。业务组合组件放 `apps/desktop`。只允许从包名根导入（`@agent2live/design-system`），禁止深路径导入。

### live2d-runtime

Cubism 运行时唯一封装（pixi-live2d-display-lipsyncpatch + PixiJS 7），Cubism 4.2 为导出基线（ADR 0001）。`live2dcubismcore.min.js` 用户本地提供，永不提交或再分发。

## 强制代码风格（pnpm check:code-style，AST 级自研检查）

违反会挡 `pnpm check`，写码时直接遵守比事后修省事：

- **无 default export**：应用与包源码一律命名导出（仅构建配置文件可用 default）。共享通过带中文单行 JSDoc 的 `index.ts` barrel。
- **组件 Props 类型**：用命名 Props interface + `React.FC<Props>`（参数本身不加类型注解）；memo/forwardRef 包裹时把 Props 作为泛型传入。组件 barrel 导出必须带 JSDoc、禁止 `export *`。
- **顶层声明之间空一行**（连续 import 除外）。
- **注释只关注设计本身，不引用文档或上下文**：注释解释实现设计——数据结构选择、不变量、边界条件、为什么这样做。禁止出现 `Phase N`、`Task N`、`ADR NNNN`、`docs/` 路径、"按计划"、"按用户要求"、"执行上下文"等引用。背景与决策依据属于 docs/，代码注释只描述代码；写完自查——把注释里时间、计划、任务、文档维度的词全删掉，剩下的应当仍是一段完整的设计说明。
- **token:lint**：renderer 源码（css/scss/tsx）禁止裸十六进制/rgb/hsl 色值（用 design token）；`border-radius` 只能用 `var(--a2l-radius-*)`（0/50% 除外）。

## 禁止入库的资产（check:no-prohibited-assets）

- `docs/plans/` 整个目录（实现计划与证据，必须保持 gitignored）
- `live2dcubismcore*.js` 及 map
- `*.moc3` / `*.cmo3` / `*.psd` / `*.psb` / `*.safetensors` / `*.ckpt` / `*.onnx`、`weights/` 目录
- `apps/desktop/src/renderer/public/golden|live2d/`

## 领域不变量（ADR 0005 / 0006）

- **版本不可变**：PromptVersion / ArtVersion 提交后不可修改；修正是创建新版本。PromptDraft 是单行可变草稿（revision 递增），历史由版本承载；提交后无 active draft，继续编辑需显式新建。
- **AI 输出永不直写草稿**：reverse/suggestion 结果先进专用结果表，用户显式应用/接受，且校验 base-hash、锁定块与版本所有权。用户锁定的颗粒块 AI 只能建议不能覆盖。
- **Jobs 是唯一副作用入口**（见上）。
- 单用户：无 user_id/tenant_id 字式占位；bearer token 只是本机回环保护，不是身份。
- 任何云 Provider 失败只降级对应能力，不阻断本地读取、版本回滚、预览与桌宠运行。

## 测试约定

- 单测与源码同目录放置：`*.test.ts` / `*.test.tsx` 或 `__tests__/` 目录。scripts 自身的测试用 `node --test`。
- E2E 驱动真实 Electron（`_electron.launch` + 临时 `AGENT2LIVE_DATA_DIR` + `AGENT2LIVE_E2E=1`，绝不触碰开发者真实 keychain vault）；helper 在 `e2e/helpers/`。视觉基线在 `e2e/visual-baselines/phase1/`。
- Playwright 默认配置用 mock provider（deterministic mocks 在 `packages/providers/src/mock*.ts`）；真实 provider 走独立配置，opt-in。

## 工作方式

- 在仓库内直接开分支开发，不要自动创建 worktree。
- 用户手动删除或修改过的内容，不要擅自加回或还原。
- 架构文档是权威：改行为前先对照 `docs/architecture/` 相应文档；重大设计变化应更新文档并按需写 ADR（`docs/decisions/`）。
