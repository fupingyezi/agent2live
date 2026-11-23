import SwaggerParser from '@apidevtools/swagger-parser'
import type { OpenAPIV3 } from 'openapi-types'
import type { OperationSpec } from './manifest/types'
import { responseTypeNames } from './response-types'

export async function validateOpenApi(document: Record<string, unknown>): Promise<void> {
  await SwaggerParser.validate(structuredClone(document) as unknown as OpenAPIV3.Document)
}

export function validateManifest(manifest: OperationSpec[]): void {
  const ids = new Set<string>()
  const routes = new Set<string>()
  for (const operation of manifest) {
    if (ids.has(operation.operationId)) {
      throw new Error(`duplicate operationId: ${operation.operationId}`)
    }
    ids.add(operation.operationId)
    const route = `${operation.method} ${operation.path}`
    if (routes.has(route)) throw new Error(`duplicate route: ${route}`)
    routes.add(route)
    if (Object.keys(operation.responses).length === 0) {
      throw new Error(`missing responses: ${route}`)
    }
    for (const response of Object.values(operation.responses)) {
      if (response?.kind === 'json' && !responseTypeNames.includes(response.type)) {
        throw new Error(`unknown response type ${response.type} in ${route}`)
      }
    }
  }
}
