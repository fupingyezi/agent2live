/** Studio 应用框架：主导航、实时连接状态和子页面容器。 */
export { StudioAppShell } from './StudioAppShell'

/** renderer 子树崩溃时的整页恢复边界。 */
export { ErrorBoundary } from './ErrorBoundary'

/** 统一展示 API 和未知错误，并提供重试及设置入口。 */
export { StudioError } from './StudioError'
export type { StudioErrorProps } from './StudioError'

/** 查询未完成时维持页面结构稳定的加载状态。 */
export { StudioLoading } from './StudioLoading'
export type { StudioLoadingProps } from './StudioLoading'

/** 角色备份列表、创建、刷新与下载操作。 */
export { CharacterBackupPanel } from './CharacterBackupPanel'
export type { CharacterBackupPanelProps } from './CharacterBackupPanel'
