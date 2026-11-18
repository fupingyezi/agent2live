export type WorkbenchView = 'prompt' | 'candidates' | 'versions'

export interface WorkbenchViewState {
  view: WorkbenchView
  promptVersionId: string | null
  artVersionId: string | null
  generationId: string | null
}

const VIEWS = new Set<WorkbenchView>(['prompt', 'candidates', 'versions'])

const PARAMS: Array<[keyof WorkbenchViewState, string]> = [
  ['view', 'view'],
  ['promptVersionId', 'version'],
  ['artVersionId', 'artVersion'],
  ['generationId', 'generation']
]

export function parseWorkbenchView(params: URLSearchParams): WorkbenchViewState {
  const rawView = params.get('view')
  return {
    view: rawView && VIEWS.has(rawView as WorkbenchView) ? (rawView as WorkbenchView) : 'prompt',
    promptVersionId: params.get('version'),
    artVersionId: params.get('artVersion'),
    generationId: params.get('generation')
  }
}

export function updateWorkbenchView(
  params: URLSearchParams,
  patch: Partial<WorkbenchViewState>
): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const [key, param] of PARAMS) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === null || value === undefined || (key === 'view' && value === 'prompt')) {
      next.delete(param)
    } else {
      next.set(param, value)
    }
  }
  return next
}
