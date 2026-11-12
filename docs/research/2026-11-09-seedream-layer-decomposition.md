# Seedream 图层分解研究记录

Status: research only; not implemented in Phase 0 or Phase 1.

## 已知事实

- Seedream（火山引擎 Ark）通过 `POST /api/v3/images/generations` 生成位图；
  `sequential_image_generation` 最多一次产生 15 张图。
- 它不能输出 PSD、语义图层、alpha 蒙版或部件坐标；多张图不是图层。
- agent2live Phase 1 只用 Seedream 生成候选立绘，接受后进入 ArtVersion；
  分层仍走手工 PSD 或外部 See-through worker。

## 可研究方向

1. 生成图 → See-through（NVIDIA）→ 分层 PSD → 语义审核 → PSD2Live。
2. 生成图 → 分割模型（如 SAM/AnimeSeg）得到粗蒙版 → 遮挡区 inpainting →
   合成层 → 人工修正；必须评估补全区域与主体一致性。
3. 多视角/多表情生成作为独立候选，而不是拆层；禁止把多图当作分层证据。
4. 质量指标：层数完整度、遮挡区错误、边缘 halo、合成回原图误差（SSIM/ΔE）、
   人工修复耗时、PSD2Live 导入失败率。

## 约束

- 不把模型权重、生成图或 PSD 提交到仓库。
- 不承诺“一键分层”，除非有固定平图的可复现实验和人工审核记录。
- 任何新模型/权重都需单独记录许可证与来源。

## 后续

Phase 2 的语义补层可用分割+inpainting 做辅助，但默认路径仍是 See-through
worker 或手工 PSD。新的结论应更新本文件并附证据链接（证据目录不提交）。
