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

## 新增端点

1. 在 `apps/server/openapi/manifest/` 对应分组增加 `OperationSpec`。
2. 在 `response-types.ts` 增加响应类型；复杂 Zod 类型加 override。
3. 运行 `pnpm api:openapi`。
4. `pnpm exec vitest run apps/server/tests/openapi.test.ts` 必须通过。
