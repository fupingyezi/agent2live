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

// Zod copies from different workspace packages share no class identity, so detection is by name.
export function zodErrorDetails(error: unknown): { issues: FieldIssue[] } | null {
  const issues = zodIssues(error)
  return issues ? { issues } : null
}

export function problemFor(
  error: unknown,
  ids: { requestId: string; traceId: string; instance: string; supportId?: string }
): ProblemDetails {
  const zodDetails = zodErrorDetails(error)
  if (zodDetails) {
    return buildProblem({ ...ids, code: 'REQUEST_INVALID', details: zodDetails })
  }
  if (error instanceof AppError) {
    return buildProblem({ ...ids, code: error.code, details: error.details })
  }
  return buildProblem({ ...ids, code: 'SYS_INTERNAL', supportId: ids.requestId })
}
