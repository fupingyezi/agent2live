# 本地 API 文档

## 生成

- `pnpm api:openapi`：生成并校验 `docs/api/openapi.json`
- `pnpm api:openapi:check`：校验 manifest、真实路由覆盖和已提交文件是否最新

## Apifox

在仓库根目录的 `.env` 中配置（参考 `.env.example`；`.env` 已被 gitignore）：

```dotenv
APIFOX_ACCESS_TOKEN=
APIFOX_PROJECT_ID=
# APIFOX_BRANCH=
# APIFOX_MODULE_MAP=
```

`api:apifox` 默认读取仓库根 `.env`；如需其他文件，用 `APIFOX_ENV_FILE` 指定路径。

- `pnpm api:apifox --dry-run`：只校验和打印脱敏命令
- `pnpm api:apifox`：导入到 Apifox

导入固定使用 `--overwrite-mode merge`，不会删除未匹配接口。`info.title` 固定为 `agent2live Local API`，用于 Apifox 模块匹配；修改前请确认目标项目模块名。

CLI 令牌通过 `apifox auth login --with-token` 持久化；需要清除时运行 `apifox auth logout`。

## 故障处理

如果导入返回 `Automation caller branch required`，说明项目开启了外部 AI 写入保护。二选一：

1. 在 Apifox 客户端 2.8.32+ 的「项目设置 - 功能设置 - 外部 AI 编辑权限」中开启当前分支的直接编辑权限，然后重试。
2. 创建或选择一个 AI 分支，把分支名写入 `.env` 的 `APIFOX_BRANCH`，再重试。AI 分支改动需要你在 Apifox 中确认后再合并，wrapper 不会自动 merge。

## 新增端点

1. 在 `apps/server/openapi/manifest/` 对应分组增加 `OperationSpec`。
2. 在 `response-types.ts` 增加响应类型；复杂 Zod 类型加 override。
3. 运行 `pnpm api:openapi`。
4. `pnpm exec vitest run apps/server/tests/openapi.test.ts` 必须通过。
