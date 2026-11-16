/** 并排比较生成候选并提供采纳入口。 */
export { CandidateCompare } from './CandidateCompare'
export type { CandidateCompareProps } from './CandidateCompare'

/** Prompt 草稿的保存、提交和版本操作工具栏。 */
export { DraftToolbar } from './DraftToolbar'
export type { DraftToolbarProps } from './DraftToolbar'

/** 从 Prompt 或立绘版本创建派生项目的对话框。 */
export { ForkDialog } from './ForkDialog'
export type { ForkDialogProps, ForkSource } from './ForkDialog'

/** 展示当前项目来源，并维护派生链接状态。 */
export { ForkOriginBar } from './ForkOriginBar'
export type { ForkOriginBarProps } from './ForkOriginBar'

/** 配置 Provider、尺寸、数量和种子并跟踪生成任务。 */
export { GenerationPanel } from './GenerationPanel'
export type { GenerationPanelProps } from './GenerationPanel'

/** 以临时 Modal 配置图像模型、数量、尺寸和 Seed。 */
export { GenerationDialog } from './GenerationDialog'
export type { GenerationDialogProps } from './GenerationDialog'

/** 展示已提交的 Prompt 输入素材及处理状态。 */
export { MaterialTray } from './MaterialTray'
export type { MaterialTrayProps } from './MaterialTray'

/** 请求、查看、接受或撤销 AI Prompt 建议。 */
export { PromptAiPanel } from './PromptAiPanel'
export type { InitialPromptJob, PromptAiPanelProps } from './PromptAiPanel'

/** 编辑单个 Prompt Block 的类别、内容与状态。 */
export { PromptBlockCard } from './PromptBlockCard'
export type { PromptBlockCardProps } from './PromptBlockCard'

/** 管理 Prompt Block 列表和未覆盖需求提示。 */
export { PromptBlockList } from './PromptBlockList'
export type { PromptBlockListProps } from './PromptBlockList'

/** 提交画布、图片和文字等 Prompt 输入材料。 */
export { PromptInputPanel } from './PromptInputPanel'
export type { PromptInputPanelProps } from './PromptInputPanel'

/** 展示版本间的参考图继承链与当前状态。 */
export { ReferenceChainBar } from './ReferenceChainBar'
export type { ReferenceChainBarProps } from './ReferenceChainBar'

/** 编辑立绘版本的参考图集合与引用关系。 */
export { ReferenceSetEditor } from './ReferenceSetEditor'
export type { ReferenceSetEditorProps } from './ReferenceSetEditor'

/** 审阅 AI 反推结果并选择应用或丢弃。 */
export { ReverseReview } from './ReverseReview'
export type { ReverseReviewProps } from './ReverseReview'

/** 展示并处理 AI Prompt 修改建议的差异。 */
export { SuggestionDiff } from './SuggestionDiff'
export type { SuggestionDiffProps } from './SuggestionDiff'

/** 展示 Prompt 与立绘版本链及派生关系。 */
export { VersionGraph } from './VersionGraph'
export type { VersionGraphProps } from './VersionGraph'

/** 左侧联动显示当前草稿与不可变美术版本。 */
export { WorkbenchVersionRail } from './WorkbenchVersionRail'
export type { WorkbenchVersionRailProps } from './WorkbenchVersionRail'

/** 在角色描述栏统一编辑完整与颗粒化提示词。 */
export { UnifiedPromptInspector } from './UnifiedPromptInspector'
export type { UnifiedPromptInspectorProps } from './UnifiedPromptInspector'

/** 管理立绘版本、手动上传、参考图和激活状态。 */
export { ArtVersionPanel } from './ArtVersionPanel'
export type { ArtVersionPanelProps } from './ArtVersionPanel'
