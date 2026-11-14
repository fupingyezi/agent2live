export interface ProjectProgressSource {
  activePromptVersionId: string | null
  activeVersionId: string | null
}

export interface ProjectProgress {
  percent: 0 | 50 | 100
  promptDone: boolean
  artDone: boolean
  nextAction: 'prompt' | 'generate' | 'review'
  nextLabel: '完善提示词' | '生成候选' | '查看版本'
}

export function computeProjectProgress(project: ProjectProgressSource): ProjectProgress {
  if (project.activeVersionId) {
    return {
      percent: 100,
      promptDone: true,
      artDone: true,
      nextAction: 'review',
      nextLabel: '查看版本'
    }
  }
  if (project.activePromptVersionId) {
    return {
      percent: 50,
      promptDone: true,
      artDone: false,
      nextAction: 'generate',
      nextLabel: '生成候选'
    }
  }
  return {
    percent: 0,
    promptDone: false,
    artDone: false,
    nextAction: 'prompt',
    nextLabel: '完善提示词'
  }
}
