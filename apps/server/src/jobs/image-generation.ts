import type { JobDefinition } from './types'
import type { GenerationService } from '../services/generations'
import { generationRequestSchema, type GenerationRequest } from '../generation/request'

export const IMAGE_GENERATION_JOB_TYPE = 'image.generate'

export function createImageGenerationJob(service: GenerationService): JobDefinition<GenerationRequest> {
  return {
    type: IMAGE_GENERATION_JOB_TYPE,
    payloadSchema: generationRequestSchema,
    sideEffect: 'non_idempotent',
    maxAttempts: 1,
    timeoutMs: 180_000,
    run: (context) => service.run(context),
    onTerminal: (outcome) => service.onTerminal(outcome)
  }
}
