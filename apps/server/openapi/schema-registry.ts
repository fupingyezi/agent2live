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
import { API_TIMESTAMP_KEYS } from '../src/http/api-json'
import { responseTypeNames, type ResponseTypeName } from './response-types'

export type JsonSchemaObject = Record<string, unknown>

const HERE = fileURLToPath(new URL('.', import.meta.url))

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

const SSE_TIMESTAMP_EXEMPT = new Set(['SseEvent'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function convertTimestampNode(node: JsonSchemaObject): void {
  const type = node.type
  if (Array.isArray(type)) {
    const nullable = type.includes('null')
    if (type.some((item) => item === 'integer' || item === 'number')) {
      node.type = 'string'
      node.format = 'date-time'
      if (nullable) node.nullable = true
    }
    return
  }
  if (type === 'integer' || type === 'number') {
    node.type = 'string'
    node.format = 'date-time'
    delete node.minimum
    delete node.maximum
    delete node.exclusiveMinimum
    delete node.exclusiveMaximum
    return
  }
  if (Array.isArray(node.anyOf)) {
    for (const branch of node.anyOf) {
      if (isRecord(branch) && (branch.type === 'integer' || branch.type === 'number')) {
        branch.type = 'string'
        branch.format = 'date-time'
      }
    }
  }
}

function walk(node: unknown, key?: string): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child)
    return
  }
  if (!isRecord(node)) return
  if (key && API_TIMESTAMP_KEYS.has(key)) convertTimestampNode(node)
  for (const [childKey, child] of Object.entries(node)) walk(child, childKey)
}

function normalizeNode(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) normalizeNode(child)
    return
  }
  if (!isRecord(node)) return
  delete node.$schema
  delete node.$id
  if (Array.isArray(node.type)) {
    const types = node.type.filter((item) => item !== 'null')
    const hadNull = types.length !== node.type.length
    node.type = types.length === 1 ? types[0] : types
    if (hadNull) node.nullable = true
  }
  if ('const' in node) {
    node.enum = [node.const]
    delete node.const
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = node[key]
    if (!Array.isArray(branches)) continue
    const nonNull = branches.filter((branch) => !(isRecord(branch) && branch.type === 'null'))
    if (nonNull.length !== branches.length) {
      node.nullable = true
      if (nonNull.length === 1) {
        Object.assign(node, nonNull[0])
        delete node[key]
      } else {
        node[key] = nonNull
      }
    }
  }
  for (const key of [
    'if',
    'then',
    'else',
    'dependentSchemas',
    'dependentRequired',
    'patternProperties',
    'propertyNames',
    'unevaluatedProperties',
    'contentMediaType',
    'contentEncoding'
  ]) {
    delete node[key]
  }
  if (typeof node.$ref === 'string') {
    node.$ref = node.$ref.replace('#/definitions/', '#/components/schemas/')
  }
  for (const child of Object.values(node)) normalizeNode(child)
}

function finalizeResponseSchemas(
  definitions: Record<string, JsonSchemaObject>
): Record<string, JsonSchemaObject> {
  for (const [name, schema] of Object.entries(definitions)) {
    if (!SSE_TIMESTAMP_EXEMPT.has(name)) walk(schema)
    normalizeNode(schema)
  }
  return definitions
}

export function buildResponseSchemas(): Record<string, JsonSchemaObject> {
  const generator = createGenerator({
    path: resolve(HERE, 'response-types.ts'),
    tsconfig: resolve(HERE, '../tsconfig.json'),
    type: '*',
    skipTypeCheck: true,
    additionalProperties: false
  })
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
  return finalizeResponseSchemas(definitions)
}

export { responseTypeNames } from './response-types'
export type { ResponseTypeName } from './response-types'
