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

export function problemFor(
  error: unknown,
  ids: { requestId: string; traceId: string; instance: string; supportId?: string }
): ProblemDetails {
  if (error instanceof AppError) {
    return buildProblem({ ...ids, code: error.code, details: error.details })
  }
  return buildProblem({ ...ids, code: 'SYS_INTERNAL', supportId: ids.requestId })
}
