# 图层修改 Manifest

初始 schema 为 `layer-patch/1`。sandbox 只通过该 manifest 提出写入请求。

```json
{
  "schema": "layer-patch/1",
  "baseVersionId": "layer-spec-id",
  "intent": "修掉选区内的暗色边缘",
  "scope": {
    "targetLayerId": "layer-hand-skin",
    "selectionAssetId": "mask-asset-id",
    "affectedLayerIds": ["layer-hand-skin"]
  },
  "operations": [
    {
      "kind": "replace_layer_pixels",
      "layerId": "layer-hand-skin",
      "imageAssetId": "candidate-image-asset-id",
      "fit": "none",
      "rebuildMesh": false
    }
  ],
  "constraints": {
    "pinnedIds": ["confirmed-right-edge"],
    "lockedLayerIds": ["layer-face"],
    "maxChangedPixels": 3000
  },
  "evidence": {
    "changedPixels": 201,
    "bbox": [637, 301, 698, 352],
    "compositeDiffPixels": 0,
    "ocrChangedText": [],
    "checks": {
      "inputsUnchanged": "pass",
      "scopeRespected": "pass",
      "pinnedUnchanged": "pass",
      "binaryOutputValid": "pass",
      "compositePreview": "pass",
      "ocrStable": "not_applicable",
      "visualRegression": "pass",
      "noNetwork": "pass"
    }
  }
}
```

## 操作类型

- `replace_layer_pixels`：用同画布尺寸的图片资产替换一个图层的像素。
- `add_layer`：在指定位置和图层顺序插入资产。
- `remove_layer`：仅在用户明确授权时删除图层。
- `rename_layer`：只改名称，不改像素。
- `reorder_layer`：相对另一个图层调整顺序。
- `set_visibility`：只改变工作台可见性，不伪装成破坏性像素修改。

新图片生成不属于该 manifest。生成资产必须先成为单独审核的候选，再由 `add_layer` 或
`replace_layer_pixels` 引用。

## 资产规则

- Asset ID 是不透明标识，由宿主签发。
- 除非操作明确指定 fit 模式，图片尺寸和原点必须与目标层一致。
- 选区 mask 必须保留空洞和精确画布坐标。
- 拒绝任意文件路径、URL、data URL 和可执行载荷。
- 拒绝输入 hash 或 pinned 集合 hash 与本次运行不一致的候选。
