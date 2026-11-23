import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promptReverseOutputSchema } from '../packages/contracts/src/prompt'
import { ApiClient, uniqueKey } from './helpers/api'
import { launchStudio } from './helpers/app'
import { writeEvidenceJson } from './helpers/evidence'
import { makePng } from './helpers/seed'

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
  preset: 'deepseek-chat' | 'zhipu-vision' | 'volcengine-ark'
  label: string
  baseUrl: string
  model: string
  apiKey: string
  custom?: boolean
}

function providerTitle(settings: RealProviderSettings): string {
  if (settings.custom) return '自定义'
  if (settings.preset === 'deepseek-chat') return 'DeepSeek'
  if (settings.preset === 'zhipu-vision') return '智谱 GLM'
  return '火山方舟'
}

async function chooseProviderOption(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).click()
  await page.locator(`[data-testid="${testId}-option"][data-value="${value}"]`).click()
}

async function selectProviderModel(page: Page, settings: RealProviderSettings): Promise<void> {
  const select = page.getByTestId('provider-model-select')
  await expect(select).toBeVisible()
  await select.click()
  const options = await page.locator('[data-testid="provider-model-select-option"]').evaluateAll((entries) =>
    entries.map((entry) => ({
      value: entry.getAttribute('data-value') ?? '',
      text: entry.textContent ?? ''
    }))
  )
  const match = options.find((option) => option.value === settings.model)
  const fallback =
    settings.kind === 'image'
      ? options.find((option) => option.text.includes('生图'))
      : options.find((option) => !option.text.includes('生图'))
  const target = match ?? fallback
  if (!target) {
    await select.click()
    return
  }
  await page.locator(`[data-testid="provider-model-select-option"][data-value="${target.value}"]`).click()
}

function requiredVisionSettings(): RealProviderSettings | null {
  if (existsSync('.env')) process.loadEnvFile('.env')
  if (process.env.AGENT2LIVE_REAL_PROVIDERS !== 'vision') return null
  const apiKey = process.env.ZHIPU_API_KEY
  if (!apiKey?.trim()) throw new Error('real vision smoke is missing ZHIPU_API_KEY')
  return {
    kind: 'chat',
    preset: 'zhipu-vision',
    label: 'Real Zhipu Vision Smoke',
    baseUrl: process.env.ZHIPU_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4',
    model: process.env.AGENT2LIVE_REAL_VISION_MODEL ?? 'glm-5.3-flash',
    apiKey
  }
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
        preset: 'volcengine-ark',
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
  const chatModel = process.env.AGENT2LIVE_REAL_CHAT_MODEL ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-flash'
  return {
    chat: {
      kind: 'chat',
      preset: 'deepseek-chat',
      label: 'Real Chat Smoke',
      baseUrl: chatBaseUrl,
      model: chatModel,
      apiKey: chatApiKey
    },
    image: {
      kind: 'image',
      preset: 'volcengine-ark',
      label: 'Real Image Smoke',
      baseUrl: imageBaseUrl,
      model: imageModel,
      apiKey: imageApiKey
    }
  }
}

async function addProvider(page: Page, settings: RealProviderSettings): Promise<void> {
  await page.getByTestId('add-provider').click()
  await chooseProviderOption(page, 'provider-preset', settings.preset)
  await page.getByTestId('provider-api-key').fill(settings.apiKey)
  await selectProviderModel(page, settings)
  await page.getByTestId('provider-submit').click()
  await expect(page.getByTestId('provider-card').filter({ hasText: providerTitle(settings) })).toBeVisible()
}

async function expectImageCatalog(page: Page, settings: RealProviderSettings): Promise<void> {
  const card = page.getByTestId('provider-card').filter({ hasText: providerTitle(settings) })
  await expect(card).toBeVisible()
  await expect(card).toContainText(/生图\s+[1-9]\d*/)
}

async function addCustomImageProvider(page: Page, settings: RealProviderSettings): Promise<void> {
  await page.getByTestId('add-provider').click()
  await chooseProviderOption(page, 'provider-preset', 'custom')
  await page.getByTestId('provider-base-url').fill(settings.baseUrl)
  await chooseProviderOption(page, 'provider-kind', 'image')
  await page.getByTestId('provider-api-key').fill(settings.apiKey)
  await page.getByTestId('provider-model-manual').fill(settings.model)
  await page.getByTestId('provider-submit').click()
  await expect(page.getByTestId('provider-card').filter({ hasText: '自定义' })).toBeVisible()
}

async function probeProvider(page: Page, settings: RealProviderSettings): Promise<ProviderCheck> {
  const card = page.locator('[data-testid="provider-card"]').filter({ hasText: providerTitle(settings) })
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
  // 卡片渲染的是探针实际调用的模型；固定连接的目录顺序可能与配置目标不同。
  const probedModel = text.match(/耗时\s+\d+\s+ms\s+·\s*(.+)/)?.[1]?.trim()
  return {
    ok: true,
    kind: settings.kind,
    adapter: settings.kind === 'chat' ? 'openai-compatible' : 'seedream',
    model: probedModel && probedModel !== '默认模型' ? probedModel : settings.model,
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

    if (settings.chat) {
      await addProvider(studio.page, settings.chat)
      checks.chat = await probeProvider(studio.page, settings.chat)
      expect(checks.chat.ok, 'real Chat provider probe').toBe(true)
    }
    // 固定火山方舟连接的 legacy kind 是 chat；目录仍需包含 image 模型。
    await addProvider(studio.page, settings.image)
    await expectImageCatalog(studio.page, settings.image)
    // 图片探针改用同源的自定义 Seedream 连接（kind: image）。
    const imageProbe: RealProviderSettings = {
      ...settings.image,
      label: `${settings.image.label} Seedream`,
      custom: true
    }
    await addCustomImageProvider(studio.page, imageProbe)
    checks.image = await probeProvider(studio.page, imageProbe)
    expect(checks.image.ok, 'real Image provider probe').toBe(true)
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

test('runs the opt-in real Zhipu vision reverse pipeline', async () => {
  test.setTimeout(600_000)
  const settings = requiredVisionSettings()
  test.skip(settings === null, 'set AGENT2LIVE_REAL_PROVIDERS=vision and ZHIPU_API_KEY to run')
  if (!settings) return

  const evidence = {
    schemaVersion: 'real-vision/1',
    status: 'fail' as 'pass' | 'fail',
    generatedAt: new Date().toISOString(),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    model: settings.model,
    latencyMs: 0,
    schemaPass: false,
    warningCount: 0
  }
  const studio = await launchStudio('agent2live-real-vision-')
  try {
    await studio.page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(studio.page.locator('[data-testid="providers-page"]')).toBeVisible()
    await addProvider(studio.page, settings)
    const providerCard = studio.page
      .locator('[data-testid="provider-card"]')
      .filter({ hasText: providerTitle(settings) })
    await expect(providerCard).toBeVisible()
    const providerId = await providerCard.getAttribute('data-provider-id')
    expect(providerId).toMatch(/^conn_/)

    const api = new ApiClient(studio.endpoint)
    const character = await api.createCharacter('智谱视觉冒烟', '用于验证参考图反推真实模型链路。')
    const project = await api.createProject(character.id, '默认造型', '视觉反推 smoke')
    const input = await api.uploadPromptInput(project.id, await makePng(512, 768, '#9ec9bb'), {
      filename: 'vision-smoke.png'
    })
    expect(input.submission.materials).toHaveLength(1)

    const startedAt = Date.now()
    const created = await api.json<{ jobId: string }>(
      'POST',
      `/api/v1/art-projects/${encodeURIComponent(project.id)}/prompt-reverse`,
      {
        headers: { 'idempotency-key': uniqueKey('real-vision-reverse') },
        body: { providerConnectionId: providerId, modelId: settings.model }
      }
    )
    const job = await api.waitForJob(created.body.jobId, 300_000)
    evidence.latencyMs = Date.now() - startedAt
    const resultId = (job.result as { reverseResultId?: unknown } | null)?.reverseResultId
    expect(resultId).toMatch(/^prv_/)

    const detail = await api.json<{
      status: string
      state: {
        blocks: unknown[]
        negativeBlocks: unknown[]
      }
    }>('GET', `/api/v1/prompt-reverse-results/${encodeURIComponent(String(resultId))}`)
    expect(detail.body.status).toBe('ready')
    const visionBlocks = detail.body.state.blocks.filter(
      (block) => (block as { source?: unknown }).source === 'vision-model'
    )
    const visionNegativeBlocks = detail.body.state.negativeBlocks.filter(
      (block) => (block as { source?: unknown }).source === 'vision-model'
    )
    expect(() =>
      promptReverseOutputSchema.parse({
        blocks: visionBlocks.map((block) => ({ ...(block as object), locked: false })),
        negativeBlocks: visionNegativeBlocks.map((block) => ({
          ...(block as object),
          locked: false
        })),
        warnings: []
      })
    ).not.toThrow()
    evidence.schemaPass = true
    evidence.status = 'pass'
  } finally {
    await studio.close()
    writeEvidenceJson('real-vision.json', evidence)
  }
})
