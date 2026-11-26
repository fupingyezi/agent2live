# See-through Worker 协议 v1

状态：现行 Provider 契约。agent2live 不随应用分发生产 worker 或模型权重。

## 用途

外部 NVIDIA 兼容 worker 把 `Live2DReadyArtVersion.layerReadyArt` 资产转换成图层化 PSD。
桌面应用上传图片字节、轮询异步任务、下载 PSD、校验 checksum，并在交给 PSD2Live 绑定前完成
PSD 安全检查。

原始 `ArtVersion.artworkAssetId` 不能直接作为分层输入。

## 安全

- worker 默认只监听 `127.0.0.1`。远程访问必须通过 SSH 隧道或私有网络；不得直接暴露在公网。
- 所有接口都要求 `Authorization: Bearer <token>`。token 由部署者提供，保存在仓库外，且不得
  写入日志。
- 上传文件和结果 24 小时后过期。worker 不得保留源立绘用于训练或遥测。

## 接口

| 方法 | 路径                   | 用途                                                 |
| ---- | ---------------------- | ---------------------------------------------------- |
| GET  | `/v1/health`           | 协议版本、worker 版本和 GPU 信息                     |
| POST | `/v1/uploads`          | 原始图片 body；带 `content-type`、`x-content-sha256` |
| POST | `/v1/jobs`             | 创建或去重一个分层任务                               |
| GET  | `/v1/jobs/{id}`        | 任务状态、manifest 和结果元数据                      |
| GET  | `/v1/jobs/{id}/result` | PSD 字节；必须带 `x-content-sha256`                  |

请求和响应正文由 `packages/contracts/src/see-through.ts` 定义。未知字段必须拒绝，时间格式为
RFC 3339 UTC。

## 限制

- 图片：PNG/JPEG/WebP，最大 20 MiB；每边 256–4096 px。
- PSD：最大 200 MiB；最多 256 个图层。
- Phase 0 每个 worker 只并发执行一个任务，其余排队。
- 客户端任务轮询超时 10 分钟。stub worker 在毫秒级完成，不实现服务端超时。
- 结果 URL/路径只属于 worker 本地，不得持久化为外部链接。

## 错误

错误使用 `application/problem+json`，字段包括 `type`、`title`、`status`、`code`，可选
`detail` 和 `requestId`。稳定错误码：

`SEE_THROUGH_UNAUTHORIZED`、`SEE_THROUGH_INVALID_INPUT`、
`SEE_THROUGH_PAYLOAD_TOO_LARGE`、`SEE_THROUGH_UNSUPPORTED_MEDIA`、
`SEE_THROUGH_CHECKSUM_MISMATCH`、`SEE_THROUGH_IDEMPOTENCY_CONFLICT`、
`SEE_THROUGH_JOB_NOT_FOUND`、`SEE_THROUGH_RESULT_NOT_READY`、
`SEE_THROUGH_RESULT_INVALID`、`SEE_THROUGH_TIMEOUT`、`SEE_THROUGH_INTERNAL`、
`SEE_THROUGH_NOT_FOUND`（未知路由或资源）。

## 保证与非目标

- worker 返回 PSD 和图层 manifest，不写应用数据库，也不调用 PSD2Live。
- 图层名称仅供参考。语义角色和可绑定标签由应用审核；无法识别的图层不得自动丢弃。
- worker 结果不是 `ArtVersion`、`Live2DReadyArtVersion` 或最终模型。
- `spikes/see-through/` 中的 stub worker 只验证契约，不产生真实语义分层。

## Provider 模式

本 v1 HTTP 契约对应默认的 `private_worker`。应用通过统一 Provider 接口支持另外两条路径：

| 模式             | 默认 | 传输方式                       | 成本/归属    |
| ---------------- | ---- | ------------------------------ | ------------ |
| `private_worker` | 是   | 本 v1 HTTP 协议                | 部署方自有   |
| `hf_space`       | 否   | 用户授权 Space 的 Gradio queue | 用户 HF 额度 |
| `manual_psd`     | 兜底 | 用户上传已有分层 PSD           | 无           |

## Hugging Face Space 适配器

已验证 Space：
`https://huggingface.co/spaces/24yearsold/see-through-demo`。

`GET /gradio_api/info` 暴露一个公开的 `/inference` 接口：

```text
image: ImageData
resolution: 768..1280
seed: 0..9999
tblr_split: boolean
```

适配器提交 `POST /gradio_api/call/inference`，读取
`GET /gradio_api/call/inference/{event_id}` 的 SSE 事件，下载返回的 PSD，然后在本地解析 PSD，
生成内部规范的图层 manifest。返回的图层 gallery 只是预览证据，不作为语义事实源。

要求：

- 用户必须明确授权把分层用立绘上传到 Hugging Face。
- 应用不得内置共享 HF token。
- 记录 Space/模型 revision、resolution、seed、split 选项、结果 hash 和耗时。
- 出现 `ZeroGPU quota exceeded` 时立即停止任务。用 Playwright 重试不会产生 GPU 容量。
- Schema 不兼容、超时、非法 PSD 或 checksum 不符时，当前 LayerSpec 保持不变。

验证时的 HF 额度约为：

- 未登录：每天 2 分钟 GPU。
- 免费账号：每天 5 分钟 GPU。
- PRO：每天 40 分钟 GPU。

该 Space 每次请求申请 120 秒 GPU 配额，因此匿名公共 Space 不能作为生产默认路径。

## 本地部署兜底

拥有 NVIDIA 硬件的部署者可以运行官方 See-through 仓库，并暴露本 v1 协议。参考管线要求
CUDA 12.8。1280 分辨率下，BF16 约需 12–16 GB VRAM；group offload 可降到约 10 GB，NF4 或
block swap 可运行在约 8 GB。macOS 原生环境不支持该本地 GPU 路径。

Space 源代码为 MIT；当前 LayerDiff 和 Marigold 模型权重为 OpenRAIL++。模型权重不随
agent2live 分发。
