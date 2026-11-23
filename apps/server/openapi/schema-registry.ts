import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGenerator } from 'ts-json-schema-generator'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { z } from 'zod'
import {
  characterBriefVersionSchema,
  promptOperationSchema,
  promptReferenceSchema,
  promptRequirementSchema,
  promptSpecSchema,
  providerCapabilitiesSchema,
  providerModelProfileSchema
} from '@agent2live/contracts'
import { generationRequestDisplaySchema, referencePlanSchema } from '../src/generation/request'
import { responseTypeNames, type ResponseTypeName } from './response-types'

export type JsonSchemaObject = Record<string, unknown>

const HERE = fileURLToPath(new URL('.', import.meta.url))
const generator = createGenerator({
  path: resolve(HERE, 'response-types.ts'),
  tsconfig: resolve(HERE, '../tsconfig.json'),
  type: '*',
  skipTypeCheck: true,
  additionalProperties: false
})

const zodOverrides: Record<string, z.ZodTypeAny> = {
  CharacterBriefVersion: characterBriefVersionSchema,
  PromptRequirement: promptRequirementSchema,
  PromptSpecV2: promptSpecSchema,
  PromptReference: promptReferenceSchema,
  PromptOperation: promptOperationSchema,
  ProviderCapabilities: providerCapabilitiesSchema,
  ProviderModelProfile: providerModelProfileSchema,
  GenerationRequestDisplay: generationRequestDisplaySchema,
  ReferencePlan: referencePlanSchema
}

const ref = (name: string): JsonSchemaObject => ({ $ref: `#/definitions/${name}` })

const propertyPatches: Array<{
  type: ResponseTypeName
  path: string[]
  schema: JsonSchemaObject
}> = [
  { type: 'PromptDraftDto', path: ['properties', 'state'], schema: ref('PromptSpecV2') },
  { type: 'PromptVersionDto', path: ['properties', 'state'], schema: ref('PromptSpecV2') },
  {
    type: 'PromptVersionDto',
    path: ['properties', 'references'],
    schema: { type: 'array', items: ref('PromptReference') }
  },
  {
    type: 'PromptReverseResultDto',
    path: ['properties', 'state'],
    schema: { anyOf: [ref('PromptSpecV2'), { type: 'null' }] }
  },
  {
    type: 'PromptSuggestionDto',
    path: ['properties', 'operations'],
    schema: { type: 'array', items: ref('PromptOperation') }
  },
  {
    type: 'PromptInputSubmissionDto',
    path: ['properties', 'requirements'],
    schema: { type: 'array', items: ref('PromptRequirement') }
  },
  {
    type: 'GenerationDto',
    path: ['properties', 'request'],
    schema: { anyOf: [ref('GenerationRequestDisplay'), { type: 'null' }] }
  },
  { type: 'GenerationCreateResult', path: ['properties', 'references'], schema: ref('ReferencePlan') },
  {
    type: 'ProviderConnectionDto',
    path: ['properties', 'models'],
    schema: { type: 'array', items: ref('ProviderModelProfile') }
  },
  {
    type: 'ProviderModelListDto',
    path: ['properties', 'items'],
    schema: { type: 'array', items: ref('ProviderModelProfile') }
  },
  {
    type: 'CharacterBriefVersionListResponse',
    path: ['properties', 'items'],
    schema: { type: 'array', items: ref('CharacterBriefVersion') }
  },
  {
    type: 'PromptVersionListResponse',
    path: ['properties', 'items'],
    schema: { type: 'array', items: ref('PromptVersionSummary') }
  },
  {
    type: 'PromptReverseResultListResponse',
    path: ['properties', 'items'],
    schema: { type: 'array', items: ref('PromptReverseResultDto') }
  },
  {
    type: 'GenerationListResponse',
    path: ['properties', 'items'],
    schema: { type: 'array', items: ref('GenerationDto') }
  },
  {
    type: 'JobEventListResponse',
    path: ['properties', 'items'],
    schema: { type: 'array', items: ref('JobEventDto') }
  },
  {
    type: 'ProviderListResponse',
    path: ['properties', 'items'],
    schema: { type: 'array', items: ref('ProviderConnectionDto') }
  },
  {
    type: 'CharacterBackupListResponse',
    path: ['properties', 'items'],
    schema: { type: 'array', items: ref('CharacterBackupDto') }
  }
]

type ZodToJsonSchema = (
  schema: z.ZodTypeAny,
  options: { target: 'openApi3'; $refStrategy: 'none' }
) => JsonSchemaObject

const convertZodSchema = zodToJsonSchema as unknown as ZodToJsonSchema

export function zodSchemaToJsonSchema(schema: z.ZodTypeAny): JsonSchemaObject {
  const result = convertZodSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none'
  })
  delete result.$schema
  return result
}

function setPath(target: JsonSchemaObject, path: string[], value: JsonSchemaObject): void {
  let cursor = target
  for (const key of path.slice(0, -1)) {
    const next = cursor[key]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(`schema patch path missing: ${path.join('.')}`)
    }
    cursor = next as JsonSchemaObject
  }
  const last = path[path.length - 1]!
  cursor[last] = value
}

export function buildResponseSchemas(): Record<string, JsonSchemaObject> {
  const generated = generator.createSchema('*') as {
    definitions?: Record<string, JsonSchemaObject>
  }
  const definitions: Record<string, JsonSchemaObject> = { ...(generated.definitions ?? {}) }

  for (const [name, schema] of Object.entries(zodOverrides)) {
    definitions[name] = zodSchemaToJsonSchema(schema)
  }
  for (const patch of propertyPatches) {
    const target = definitions[patch.type]
    if (!target) throw new Error(`missing response type for patch: ${patch.type}`)
    setPath(target, patch.path, patch.schema)
  }
  for (const name of responseTypeNames) {
    if (!definitions[name]) throw new Error(`missing response schema: ${name}`)
  }
  return definitions
}

export { responseTypeNames } from './response-types'
export type { ResponseTypeName } from './response-types'
