import { ApiError } from '../api/client'

export interface StudioErrorCopy {
  title: string
  description: string
  code: string | null
  supportId: string | null
  showSettings: boolean
  tone: 'retryable' | 'blocked' | 'fatal'
}

export function describeStudioError(error: unknown): StudioErrorCopy {
  if (!(error instanceof ApiError)) {
    return {
      title: '操作失败',
      description: '发生了未预期的错误，请重试。',
      code: null,
      supportId: null,
      showSettings: false,
      tone: 'retryable'
    }
  }

  if (error.code === 'SYS_SIDECAR_UNAVAILABLE') {
    return {
      title: '无法连接本地工作台',
      description: error.message,
      code: error.code,
      supportId: null,
      showSettings: false,
      tone: 'blocked'
    }
  }

  if (error.code === 'AUTH_LOCAL_TOKEN_INVALID') {
    return {
      title: '本地会话已失效',
      description: '请重启应用以重新建立本地连接。',
      code: error.code,
      supportId: null,
      showSettings: false,
      tone: 'fatal'
    }
  }

  if (error.status === 404 || error.code === 'RESOURCE_NOT_FOUND') {
    return {
      title: '内容不存在',
      description: '它可能已被删除，或从未创建成功。',
      code: error.code,
      supportId: error.supportId || null,
      showSettings: false,
      tone: 'blocked'
    }
  }

  if (error.code.startsWith('PROVIDER_')) {
    return {
      title: 'AI 服务不可用',
      description: error.message,
      code: error.code,
      supportId: error.supportId || null,
      showSettings: true,
      tone: 'retryable'
    }
  }

  return {
    title: error.problem.title || '操作失败',
    description: error.message,
    code: error.code,
    supportId: error.supportId || null,
    showSettings: error.userAction === 'open_settings',
    tone: 'retryable'
  }
}
