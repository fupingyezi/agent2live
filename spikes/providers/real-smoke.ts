import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OpenAIChatProvider } from '../../packages/providers/src/openai-compatible'
import { SeedreamImageProvider } from '../../packages/providers/src/seedream'
import { ProviderError } from '../../packages/providers/src/errors'

interface Report {
  kind: 'provider-real-smoke'
  enabled: boolean
  chat: { status: 'pass' | 'blocked' | 'fail'; model: string | null; error: string | null }
  image: {
    status: 'pass' | 'blocked' | 'fail'
    model: string | null
    error: string | null
    images: Array<{ sha256: string; width: number; height: number; bytes: number }>
  }
  credentialSource: 'env'
  finishedAt: string
}

async function main(): Promise<void> {
  const evidenceDir = resolve('docs/plans/evidence/phase0/G0-PROVIDER')
  mkdirSync(evidenceDir, { recursive: true })
  const enabled = process.env.PROVIDER_SMOKE_REAL === '1'
  const report: Report = {
    kind: 'provider-real-smoke',
    enabled,
    chat: { status: 'blocked', model: null, error: null },
    image: { status: 'blocked', model: null, error: null, images: [] },
    credentialSource: 'env',
    finishedAt: new Date().toISOString()
  }

  if (!enabled) {
    report.chat.error = 'PROVIDER_SMOKE_DISABLED'
    report.image.error = 'PROVIDER_SMOKE_DISABLED'
  } else {
    const chatBase = process.env.OPENAI_BASE_URL
    const chatKey = process.env.OPENAI_API_KEY
    const chatModel = process.env.OPENAI_MODEL
    if (chatBase && chatKey && chatModel) {
      try {
        const provider = new OpenAIChatProvider({ baseUrl: chatBase, apiKey: chatKey, model: chatModel })
        const result = await provider.generate(
          {
            messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
            maxTokens: 16,
            temperature: 0
          },
          { requestId: 'phase0-chat-smoke', timeoutMs: 60_000 }
        )
        report.chat = {
          status: result.text.toLowerCase().includes('pong') ? 'pass' : 'fail',
          model: result.model,
          error: null
        }
      } catch (error) {
        report.chat = {
          status: 'fail',
          model: null,
          error: error instanceof ProviderError ? error.code : 'PROVIDER_UNEXPECTED'
        }
      }
    } else {
      report.chat.error = 'OPENAI_SMOKE_ENV_MISSING'
    }

    const imageBase = process.env.SEEDREAM_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3'
    const imageKey = process.env.SEEDREAM_API_KEY
    const imageModel = process.env.SEEDREAM_MODEL
    if (imageKey && imageModel) {
      try {
        const provider = new SeedreamImageProvider({
          baseUrl: imageBase,
          apiKey: imageKey,
          model: imageModel
        })
        const result = await provider.generate(
          {
            prompt: 'A simple flat-color cartoon face on a plain white background.',
            size: '1024x1024',
            count: 1
          },
          { requestId: 'phase0-image-smoke', timeoutMs: 5 * 60_000 }
        )
        report.image = {
          status: result.images.length > 0 ? 'pass' : 'fail',
          model: result.model,
          error: null,
          images: result.images.map(({ sha256, width, height, data }) => ({
            sha256,
            width,
            height,
            bytes: data.length
          }))
        }
      } catch (error) {
        report.image = {
          status: 'fail',
          model: null,
          error: error instanceof ProviderError ? error.code : 'PROVIDER_UNEXPECTED',
          images: []
        }
      }
    } else {
      report.image.error = 'SEEDREAM_SMOKE_ENV_MISSING'
    }
  }

  const file = resolve(evidenceDir, 'real-smoke.json')
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  const statuses = [report.chat.status, report.image.status]
  if (statuses.includes('fail')) process.exitCode = 1
  else if (statuses.includes('blocked')) process.exitCode = 2
  else process.exitCode = 0
}

main().catch((error) => {
  const evidenceDir = resolve('docs/plans/evidence/phase0/G0-PROVIDER')
  const report: Report = {
    kind: 'provider-real-smoke',
    enabled: process.env.PROVIDER_SMOKE_REAL === '1',
    chat: { status: 'fail', model: null, error: 'PROVIDER_SMOKE_CRASH' },
    image: { status: 'fail', model: null, error: 'PROVIDER_SMOKE_CRASH', images: [] },
    credentialSource: 'env',
    finishedAt: new Date().toISOString()
  }
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(resolve(evidenceDir, 'real-smoke.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
