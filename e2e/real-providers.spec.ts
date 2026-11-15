import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { launchStudio } from './helpers/app'
import { writeEvidenceJson } from './helpers/evidence'

interface ProviderCheck {
  ok: boolean
  kind: 'chat' | 'image'
  adapter: 'openai-compatible' | 'seedream'
  model: string
  latencyMs: number
  errorCode?: string
}

interface RealProviderSettings {
  kind: 'chat' | 'image'
  preset: 'openai-chat' | 'seedream-image'
  label: string
  baseUrl: string
  model: string
  apiKey: string
}

function requiredSettings(): {
  chat: RealProviderSettings | null
  image: RealProviderSettings
} | null {
  if (existsSync('.env')) process.loadEnvFile('.env')
  const mode = process.env.AGENT2LIVE_REAL_PROVIDERS
  if (mode !== '1' && mode !== 'image') return null
  const imageApiKey = process.env.AGENT2LIVE_REAL_IMAGE_API_KEY ?? process.env.SEEDREAM_API_KEY
  if (!imageApiKey?.trim()) {
    throw new Error('real provider smoke is missing AGENT2LIVE_REAL_IMAGE_API_KEY or SEEDREAM_API_KEY')
  }
  const imageBaseUrl =
    process.env.AGENT2LIVE_REAL_IMAGE_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3'
  const imageModel = process.env.AGENT2LIVE_REAL_IMAGE_MODEL ?? 'doubao-seedream-5-0-pro-260628'
  if (mode === 'image') {
    return {
      chat: null,
      image: {
        kind: 'image',
        preset: 'seedream-image',
        label: 'Real Image Smoke',
        baseUrl: imageBaseUrl,
        model: imageModel,
        apiKey: imageApiKey
      }
    }
  }
  const chatApiKey = process.env.AGENT2LIVE_REAL_CHAT_API_KEY ?? process.env.DEEPSEEK_API_KEY
  if (!chatApiKey?.trim()) {
    throw new Error('real provider smoke is missing AGENT2LIVE_REAL_CHAT_API_KEY or DEEPSEEK_API_KEY')
  }
  const chatBaseUrl =
    process.env.AGENT2LIVE_REAL_CHAT_BASE_URL ??
    process.env.DEEPSEEK_BASE_URL ??
    'https://api.deepseek.com/v1'
  const chatModel = process.env.AGENT2LIVE_REAL_CHAT_MODEL ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
  return {
    chat: {
      kind: 'chat',
      preset: 'openai-chat',
      label: 'Real Chat Smoke',
      baseUrl: chatBaseUrl,
      model: chatModel,
      apiKey: chatApiKey
    },
    image: {
      kind: 'image',
      preset: 'seedream-image',
      label: 'Real Image Smoke',
      baseUrl: imageBaseUrl,
      model: imageModel,
      apiKey: imageApiKey
    }
  }
}

async function addProvider(page: Page, settings: RealProviderSettings): Promise<void> {
  await page.locator('[data-testid="add-provider"]').click()
  await page.locator('[data-testid="provider-preset"]').selectOption(settings.preset)
  await page.locator('[data-testid="provider-label"]').fill(settings.label)
  await page.locator('[data-testid="provider-base-url"]').fill(settings.baseUrl)
  await page.locator('[data-testid="provider-model"]').fill(settings.model)
  await page.locator('[data-testid="provider-api-key"]').fill(settings.apiKey)
  await page.locator('[data-testid="provider-submit"]').click()
  await expect(
    page.locator('[data-testid="provider-card"]').filter({ hasText: settings.label })
  ).toBeVisible()
}

async function probeProvider(page: Page, settings: RealProviderSettings): Promise<ProviderCheck> {
  const card = page.locator('[data-testid="provider-card"]').filter({ hasText: settings.label })
  await card.getByRole('button', { name: '测试连接', exact: true }).click()
  if (settings.kind === 'image') {
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('可能产生费用')
    await dialog.getByRole('button', { name: '开始测试', exact: true }).click()
  }
  const result = card.getByTestId('provider-probe-result')
  await expect(result).toBeVisible({ timeout: settings.kind === 'image' ? 300_000 : 60_000 })
  if ((await result.getAttribute('data-state')) !== 'pass') {
    return {
      ok: false,
      kind: settings.kind,
      adapter: settings.kind === 'chat' ? 'openai-compatible' : 'seedream',
      model: settings.model,
      latencyMs: 0,
      errorCode: 'PROVIDER_PROBE_FAILED'
    }
  }
  const text = await result.innerText()
  const match = text.match(/耗时\s+(\d+)\s+ms/)
  return {
    ok: true,
    kind: settings.kind,
    adapter: settings.kind === 'chat' ? 'openai-compatible' : 'seedream',
    model: settings.model,
    latencyMs: match ? Number(match[1]) : 0
  }
}

test('runs opt-in real Chat and Image provider probes', async () => {
  test.setTimeout(600_000)
  const settings = requiredSettings()
  test.skip(settings === null, 'set AGENT2LIVE_REAL_PROVIDERS=1 and provider credentials to run')
  if (!settings) return

  const checks: Record<'chat' | 'image', ProviderCheck> = {
    chat: {
      ok: false,
      kind: 'chat',
      adapter: 'openai-compatible',
      model: settings.chat?.model ?? 'not-configured',
      latencyMs: 0,
      errorCode: 'PROVIDER_PROBE_NOT_CONFIGURED'
    },
    image: {
      ok: false,
      kind: 'image',
      adapter: 'seedream',
      model: settings.image.model,
      latencyMs: 0,
      errorCode: 'PROVIDER_PROBE_NOT_RUN'
    }
  }

  const studio = await launchStudio('agent2live-real-providers-')
  try {
    await studio.page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(studio.page.locator('[data-testid="providers-page"]')).toBeVisible()

    await addProvider(studio.page, settings.image)
    checks.image = await probeProvider(studio.page, settings.image)

    expect(checks.image.ok, 'real Image provider probe').toBe(true)
    if (settings.chat) {
      await addProvider(studio.page, settings.chat)
      checks.chat = await probeProvider(studio.page, settings.chat)
      expect(checks.chat.ok, 'real Chat provider probe').toBe(true)
    }
  } finally {
    await studio.close()
    writeEvidenceJson('real-providers.json', {
      schemaVersion: 'real-providers/1',
      status:
        checks.chat.ok && checks.image.ok
          ? 'pass'
          : settings.chat === null && checks.image.ok
            ? 'partial'
            : 'fail',
      generatedAt: new Date().toISOString(),
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      checks: settings.chat ? checks : { image: checks.image }
    })
  }
})
