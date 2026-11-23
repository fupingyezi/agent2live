import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertManifestCoverage, collectRegisteredRoutes } from './coverage'
import { buildOpenApiDocument } from './generate'
import { manifest } from './manifest'
import { validateManifest, validateOpenApi } from './validate'

const HERE = fileURLToPath(new URL('.', import.meta.url))
export const OPENAPI_OUTPUT = resolve(HERE, '../../../docs/api/openapi.json')

export async function renderOpenApi(): Promise<string> {
  validateManifest(manifest)
  const document = buildOpenApiDocument()
  await validateOpenApi(document)
  assertManifestCoverage(manifest, await collectRegisteredRoutes())
  return `${JSON.stringify(document, null, 2)}\n`
}

export async function assertOpenApiCurrent(): Promise<void> {
  const expected = await renderOpenApi()
  const current = readFileSync(OPENAPI_OUTPUT, 'utf8')
  if (current !== expected) {
    throw new Error('docs/api/openapi.json 已过期；请运行 pnpm api:openapi')
  }
}

export async function writeOpenApi(): Promise<void> {
  const text = await renderOpenApi()
  mkdirSync(dirname(OPENAPI_OUTPUT), { recursive: true })
  writeFileSync(OPENAPI_OUTPUT, text)
}
