import { buildProblem, type ProblemDetails } from '@agent2live/contracts'

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
    message = code
  ) {
    super(message)
    this.name = 'AppError'
  }
}

interface FieldIssue {
  path: string
  code: string
}

function zodIssues(error: unknown): FieldIssue[] | null {
  if (!(error instanceof Error) || error.name !== 'ZodError') return null
  const issues = (error as { issues?: unknown }).issues
  if (!Array.isArray(issues)) return null
  return issues.slice(0, 50).map((issue) => {
    const typed = issue as { path?: unknown; code?: unknown }
    const path = Array.isArray(typed.path) ? typed.path.map(String).join('.') : ''
    return {
      path: path.slice(0, 200),
      code: String(typed.code ?? 'invalid').slice(0, 80)
    }
  })
}

export function problemFor(
  error: unknown,
  ids: { requestId: string; traceId: string; instance: string; supportId?: string }
): ProblemDetails {
  const issues = zodIssues(error)
  if (issues) {
    return buildProblem({ ...ids, code: 'REQUEST_INVALID', details: { issues } })
  }
  if (error instanceof AppError) {
    return buildProblem({ ...ids, code: error.code, details: error.details })
  }
  return buildProblem({ ...ids, code: 'SYS_INTERNAL', supportId: ids.requestId })
}
