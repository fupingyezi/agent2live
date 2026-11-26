# Verified versions

Recorded: 2026-11-09 · See-through provider check updated 2026-11-26
Host: macOS 26.4 arm64 (Darwin 25.4.0)

| Tool / package                   | Version                                    | Source                                        |
| -------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Node.js                          | 22.23.2                                    | `node -v`                                     |
| pnpm                             | 11.25.0                                    | `pnpm -v`                                     |
| Python                           | 3.14.7                                     | `python3 --version`                           |
| JDK                              | 21.0.12.1                                  | `java -version`                               |
| Codex CLI                        | 0.153.2                                    | `codex --version`                             |
| Claude Code                      | 2.1.260                                    | `claude --version`                            |
| Electron                         | 44.7.2                                     | `pnpm-lock.yaml`                              |
| electron-builder                 | 26.18.0                                    | `pnpm-lock.yaml`                              |
| electron-vite                    | 5.0.0                                      | `pnpm-lock.yaml`                              |
| Vite                             | 7.3.7                                      | `pnpm-lock.yaml`                              |
| React                            | 18.3.1                                     | `pnpm-lock.yaml`                              |
| TypeScript                       | 5.9.3                                      | `pnpm-lock.yaml`                              |
| Prettier                         | 3.6.2                                      | `pnpm-lock.yaml`                              |
| Vitest                           | 5.0.4                                      | `pnpm-lock.yaml`                              |
| PixiJS                           | 7.4.3                                      | `pnpm-lock.yaml`                              |
| pixi-live2d-display-lipsyncpatch | 0.5.0-ls-8                                 | `pnpm-lock.yaml`                              |
| Cubism Core                      | 由用户本地提供，不提交                     | `scripts/install-cubism-core.mjs` 输出        |
| @playwright/test                 | 1.65.0                                     | `pnpm-lock.yaml`                              |
| @vitejs/plugin-react             | 5.2.0                                      | `pnpm-lock.yaml`                              |
| @electron/rebuild                | 4.2.1                                      | `pnpm-lock.yaml`                              |
| sharp                            | 0.35.5                                     | `pnpm-lock.yaml`                              |
| tsx                              | 4.23.15                                    | `pnpm-lock.yaml`                              |
| tsup                             | 9.0.0                                      | `pnpm-lock.yaml`                              |
| ag-psd                           | 34.1.0                                     | `pnpm-lock.yaml`                              |
| @types/node                      | 22.20.5                                    | `pnpm-lock.yaml`                              |
| See-through HF Space             | Gradio 6.12, zero-a10g                     | `GET /api/spaces/24yearsold/see-through-demo` |
| See-through Space revision       | `1353d30ff7d150c8eba6c8037dc8694151e85498` | Space metadata                                |
| @types/react                     | 18.3.31                                    | `pnpm-lock.yaml`                              |
| @types/react-dom                 | 18.3.7                                     | `pnpm-lock.yaml`                              |
| Fastify                          | 5.12.8                                     | `pnpm-lock.yaml`                              |
| @fastify/cors                    | 11.4.1                                     | `pnpm-lock.yaml`                              |
| better-sqlite3                   | 13.0.3                                     | `pnpm-lock.yaml`                              |
| @types/better-sqlite3            | 9.6.0                                      | `pnpm-lock.yaml`                              |
| sqlite-vec                       | 0.1.9                                      | `pnpm-lock.yaml`                              |
| pino                             | 10.4.0                                     | `pnpm-lock.yaml`                              |
| zod                              | 3.25.76                                    | `pnpm-lock.yaml`                              |
| ulid                             | 3.0.2                                      | `pnpm-lock.yaml`                              |

## Baseline notes

- `@vitejs/plugin-react` is pinned to `5.2.0` instead of the current latest `6.3.0`: the 6.x line requires Vite `^8.0.0`, while this task pins Vite `7.3.7`. Deviates from the unpinned install command; satisfies the Vite baseline.
- `ag-psd` resolved to `34.1.0` under pnpm's mature-release policy even though the registry `latest` tag is `34.2.0`.
- pnpm 11 replaced `onlyBuiltDependencies` with `allowBuilds`. `pnpm-workspace.yaml` keeps the plan's `onlyBuiltDependencies` block for traceability and adds the effective `allowBuilds` decisions.
- Type packages track the pinned runtime majors: `@types/node` 22.x (Node 22.23.2) and `@types/react` / `@types/react-dom` 18.3.x (React 18.3.1).

## License boundaries

- 根项目：GPL-3.0-only。
- Cubism Core：按 Live2D SDK 发行许可由用户本地安装；不随 git 分发。
- PSD2Live：GPL-3.0；作为独立进程的外部 Binder，不复制其二进制进仓库。
- See-through 源码：Apache-2.0。
- See-through HF demo Space `24yearsold/see-through-demo`：MIT；模型权重单独授权。
- `layerdifforg/seethroughv0.0.2_layerdiff3d`：OpenRAIL++。
- `layerdifforg/seethroughv0.0.1_marigold`：OpenRAIL++。
- See-through 权重、量化权重和缓存不进入仓库或发行包。
- 样例模型（`CubismWebSamples` 下的 Haru 等）：仅本地验证，不复制进仓库。
- 所有真实 Provider 密钥只存 OS keychain 或进程环境，不写文档/日志/数据库。

## See-through provider notes

- 线上 HF Space 当前为 Gradio 6.12、`zero-a10g`，公开 API `/inference`。
- 匿名 ZeroGPU 额度与用户账号额度分开；Space 不可作为匿名生产后端。
- 用户图片上传到 HF 前必须取得明确授权；应用不得内置共享 HF token。
- 参考本地推理环境：Linux、NVIDIA CUDA 12.8；1280 分辨率 BF16 约 12–16 GB VRAM，
  group offload 约 10 GB，NF4/block swap 约 8 GB。
