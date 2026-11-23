import { assertOpenApiCurrent, writeOpenApi } from '../openapi/pipeline'

const check = process.argv.includes('--check')
if (check) {
  await assertOpenApiCurrent()
  console.log('OpenAPI is current')
} else {
  await writeOpenApi()
  console.log('Wrote docs/api/openapi.json')
}
