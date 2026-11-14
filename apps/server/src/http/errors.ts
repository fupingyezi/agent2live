import { AppError, zodErrorDetails } from '../errors'
import { MAX_IMAGE_BYTES } from '../images/validate'

function fastifyErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  const zodDetails = zodErrorDetails(error)
  if (zodDetails) return new AppError('REQUEST_INVALID', zodDetails)
  const code = fastifyErrorCode(error)
  if (
    code === 'FST_ERR_VALIDATION' ||
    code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    code === 'FST_ERR_CTP_BODY_TOO_LARGE'
  ) {
    return new AppError('REQUEST_INVALID', { reason: 'request body is invalid' })
  }
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return new AppError('ASSET_TOO_LARGE', { bytes: 0, limit: MAX_IMAGE_BYTES })
  }
  return new AppError('SYS_INTERNAL', {})
}
