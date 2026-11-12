# Verified versions

Recorded: 2026-11-09
Host: macOS 26.4 arm64 (Darwin 25.4.0)

| Tool / package                   | Version                | Source                                 |
| -------------------------------- | ---------------------- | -------------------------------------- |
| Node.js                          | 22.23.2                | `node -v`                              |
| pnpm                             | 11.25.0                | `pnpm -v`                              |
| Python                           | 3.14.7                 | `python3 --version`                    |
| JDK                              | 21.0.12.1              | `java -version`                        |
| Codex CLI                        | 0.153.2                | `codex --version`                      |
| Claude Code                      | 2.1.260                | `claude --version`                     |
| Electron                         | 44.7.2                 | `pnpm-lock.yaml`                       |
| electron-builder                 | 26.18.0                | `pnpm-lock.yaml`                       |
| electron-vite                    | 5.0.0                  | `pnpm-lock.yaml`                       |
| Vite                             | 7.3.7                  | `pnpm-lock.yaml`                       |
| React                            | 18.3.1                 | `pnpm-lock.yaml`                       |
| TypeScript                       | 5.9.3                  | `pnpm-lock.yaml`                       |
| Prettier                         | 3.6.2                  | `pnpm-lock.yaml`                       |
| Vitest                           | 5.0.4                  | `pnpm-lock.yaml`                       |
| PixiJS                           | 7.4.3                  | `pnpm-lock.yaml`                       |
| pixi-live2d-display-lipsyncpatch | 0.5.0-ls-8             | `pnpm-lock.yaml`                       |
| Cubism Core                      | 由用户本地提供，不提交 | `scripts/install-cubism-core.mjs` 输出 |
| @playwright/test                 | 1.65.0                 | `pnpm-lock.yaml`                       |
| @vitejs/plugin-react             | 5.2.0                  | `pnpm-lock.yaml`                       |
| @electron/rebuild                | 4.2.1                  | `pnpm-lock.yaml`                       |
| sharp                            | 0.35.5                 | `pnpm-lock.yaml`                       |
| tsx                              | 4.23.15                | `pnpm-lock.yaml`                       |
| tsup                             | 9.0.0                  | `pnpm-lock.yaml`                       |
| ag-psd                           | 34.1.0                 | `pnpm-lock.yaml`                       |
| @types/node                      | 26.6.6                 | `pnpm-lock.yaml`                       |
| @types/react                     | 19.3.0                 | `pnpm-lock.yaml`                       |
| @types/react-dom                 | 19.3.0                 | `pnpm-lock.yaml`                       |
| Fastify                          | 5.12.8                 | `pnpm-lock.yaml`                       |
| @fastify/cors                    | 11.4.1                 | `pnpm-lock.yaml`                       |
| better-sqlite3                   | 13.0.3                 | `pnpm-lock.yaml`                       |
| @types/better-sqlite3            | 9.6.0                  | `pnpm-lock.yaml`                       |
| sqlite-vec                       | 0.1.9                  | `pnpm-lock.yaml`                       |
| pino                             | 10.4.0                 | `pnpm-lock.yaml`                       |
| zod                              | 3.25.76                | `pnpm-lock.yaml`                       |
| ulid                             | 3.0.2                  | `pnpm-lock.yaml`                       |

## Baseline notes

- `@vitejs/plugin-react` is pinned to `5.2.0` instead of the current latest `6.3.0`: the 6.x line requires Vite `^8.0.0`, while this task pins Vite `7.3.7`. Deviates from the unpinned install command; satisfies the Vite baseline.
- `ag-psd` resolved to `34.1.0` under pnpm's mature-release policy even though the registry `latest` tag is `34.2.0`.
- pnpm 11 replaced `onlyBuiltDependencies` with `allowBuilds`. `pnpm-workspace.yaml` keeps the plan's `onlyBuiltDependencies` block for traceability and adds the effective `allowBuilds` decisions.

## License boundaries

- 根项目：GPL-3.0-only。
- Cubism Core：按 Live2D SDK 发行许可由用户本地安装；不随 git 分发。
- PSD2Live：GPL-3.0；作为独立进程的外部 Binder，不复制其二进制进仓库。
- See-through：Apache-2.0；权重不进入仓库。
- 样例模型（`CubismWebSamples` 下的 Haru 等）：仅本地验证，不复制进仓库。
- 所有真实 Provider 密钥只存 OS keychain 或进程环境，不写文档/日志/数据库。
