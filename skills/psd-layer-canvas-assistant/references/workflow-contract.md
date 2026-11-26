# 图层画布运行契约

## 任务状态

```text
queued -> running -> preview_ready -> accepted | rejected
                        |-> failed
                        |-> stale
                        |-> blocked
```

只有 `preview_ready` 可以进入 `accepted`。`failed`、`stale` 和 `blocked` 都不得改变当前项目
版本。

## 输入绑定

每次运行都要冻结：

- 基线 LayerSpecVersion ID 和 hash；
- 当前目标层及所有相交层 ID；
- 选区 mask 和多边形几何；
- pinned 约束和锁定图层 ID；
- 相关的历史接受/拒绝修正；
- skill 版本和 runner 版本。

如果运行期间基线 LayerSpecVersion 发生变化，把结果标记为 stale，不得应用。

## 脚本生命周期

一次性脚本是执行细节，不是项目资产。

- 在应用运行时临时区创建随机目录，并在其中生成脚本。
- 进程只能访问该目录和只读输入快照。
- 禁止安装包、读取凭据和发起网络请求。
- 默认执行超时为 60 秒。
- 需要诊断时记录脚本 hash 和结构化错误码。
- accepted、rejected、failed、stale 或 blocked 后删除脚本和工作文件。

只持久化 patch manifest、输出资产、skill 身份、输入 hash、校验证据和运行摘要。

## 重试规则

- runner 或确定性校验失败时，可为同一意图修订一次脚本。
- 第二次失败后停止，并报告失败的校验条件。
- 需要生成新像素时停止沙箱路径，创建单独可见的生成候选。
- 选区或版本冲突时立即停止，并刷新画布上下文。
- 需要 PSD2Live 拓扑修改时停在图层画布边界。

## 用户确认

提案必须展示：

1. 理解到的用户意图。
2. 将变化的图层。
3. 修改前后的预览。
4. 变化像素数和区域。
5. 校验结果。
6. 不确定项或新生成内容。

接受后创建新的不可变版本。拒绝时精确保留基线版本。
