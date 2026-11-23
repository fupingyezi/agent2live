import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiClient } from './helpers/api'
import { waitForEndpoint } from './helpers/app'
import { studioPage } from './support/windows'

const FIRST_KEY = 'sk-e2e-secret-do-not-leak'
const SECOND_KEY = 'sk-e2e-rotated-do-not-leak'

interface ProviderJson {
  id: string
  label: string
  adapter: string
  baseUrl: string | null
  model: string | null
  enabled: boolean
  hasSecret: boolean
  models: Array<{ id: string; kind: string }>
  rowVersion: number
}

function findPlaintext(root: string, needle: string): string[] {
  const hits: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(path)
      } else if (entry.isFile()) {
        const content = readFileSync(path)
        if (content.includes(Buffer.from(needle))) hits.push(path)
      }
    }
  }
  visit(root)
  return hits
}

async function readRawProviders(page: Awaited<ReturnType<typeof studioPage>>): Promise<string> {
  return page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        agent2live: { getServerInfo(): Promise<{ baseUrl: string; token: string }> }
      }
    ).agent2live
    const info = await bridge.getServerInfo()
    const response = await fetch(`${info.baseUrl}/api/v1/providers`, {
      headers: { authorization: `Bearer ${info.token}`, accept: 'application/json' }
    })
    if (!response.ok) throw new Error(await response.text())
    return await response.text()
  })
}

async function readProviders(page: Awaited<ReturnType<typeof studioPage>>): Promise<ProviderJson[]> {
  return (JSON.parse(await readRawProviders(page)) as { items: ProviderJson[] }).items
}

async function chooseProviderOption(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).click()
  await page.locator(`[data-testid="${testId}-option"][data-value="${value}"]`).click()
}

test('stores provider secrets in the vault and never exposes them through the API', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-providers-'))
  const app = await electron.launch({
    args: ['apps/desktop/out/main/index.js'],
    env: { ...process.env, AGENT2LIVE_DATA_DIR: dataDir, AGENT2LIVE_E2E: '1' }
  })

  try {
    const studio = await studioPage(app)
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    await expect(studio.locator('[data-testid="studio-global-status"]')).toContainText('实时已连接', {
      timeout: 20_000
    })
    const api = new ApiClient(await waitForEndpoint(dataDir))

    await studio.getByRole('button', { name: '设置', exact: true }).click()
    await expect(studio.locator('[data-testid="providers-page"]')).toBeVisible()
    await expect(studio.locator('[data-testid="providers-empty"]')).toBeVisible()

    // Mock 旧连接：不可在 UI 新建，通过 e2e API 预置后仍可显示与探测。
    const mockImage = await api.createMockImageProvider('Mock 生图')
    const mockChat = await api.createMockChatProvider('Mock 对话')
    await studio.reload()
    await expect(studio.locator('[data-testid="providers-page"]')).toBeVisible({ timeout: 20_000 })
    await expect(studio.locator('[data-testid="provider-card"]')).toHaveCount(2)

    const mockCard = studio.locator(`[data-testid="provider-card"][data-provider-id="${mockImage.id}"]`)
    const mockChatCard = studio.locator(`[data-testid="provider-card"][data-provider-id="${mockChat.id}"]`)
    await expect(mockCard).toBeVisible()
    await expect(mockCard.getByText('无需密钥')).toBeVisible()
    await expect(mockCard.getByText('已启用')).toBeVisible()
    await expect(mockChatCard).toBeVisible()

    const beforeProbe = await readProviders(studio)
    await mockChatCard.getByRole('button', { name: '测试连接', exact: true }).click()
    await expect(mockChatCard.getByTestId('provider-probe-result')).toContainText('连接正常', {
      timeout: 20_000
    })
    await expect(mockChatCard.getByTestId('provider-probe-result')).toContainText('ms')

    await mockCard.getByRole('button', { name: '测试连接', exact: true }).click()
    const billingDialog = studio.getByRole('dialog')
    await expect(billingDialog).toContainText('可能产生费用')
    await billingDialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(mockCard.getByTestId('provider-probe-result')).toHaveCount(0)
    await mockCard.getByRole('button', { name: '测试连接', exact: true }).click()
    await studio.getByRole('dialog').getByRole('button', { name: '开始测试', exact: true }).click()
    await expect(mockCard.getByTestId('provider-probe-result')).toContainText('连接正常', {
      timeout: 20_000
    })
    const afterProbe = await readProviders(studio)
    expect(afterProbe.map((provider) => [provider.id, provider.rowVersion])).toEqual(
      beforeProbe.map((provider) => [provider.id, provider.rowVersion])
    )

    // 固定服务商：不展示 Base URL、无连接名称/手填模型、内置模型下拉。
    await studio.locator('[data-testid="add-provider"]').click()
    await studio.getByTestId('provider-preset').click()
    const presetOptions = await studio
      .locator('[data-testid="provider-preset-option"]')
      .evaluateAll((options) => options.map((option) => option.getAttribute('data-value')))
    expect(presetOptions).toEqual([
      'deepseek-chat',
      'zhipu-vision',
      'volcengine-ark',
      'kimi-chat',
      'qwen-chat',
      'minimax-chat',
      'custom'
    ])
    await studio.locator('[data-testid="provider-preset-option"][data-value="volcengine-ark"]').click()
    await expect(studio.getByTestId('provider-fixed-base-url')).toHaveCount(0)
    await expect(studio.getByTestId('provider-base-url')).toHaveCount(0)
    await expect(studio.getByTestId('provider-label')).toHaveCount(0)
    await expect(studio.getByTestId('provider-fetch-models')).toHaveCount(0)
    await expect(studio.getByTestId('provider-model-select')).toBeVisible()
    await studio.getByTestId('provider-model-select').click()
    await studio
      .locator('[data-testid="provider-model-select-option"][data-value="doubao-seedream-5-0-pro-260628"]')
      .click()
    await studio.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(studio.getByRole('dialog')).toBeHidden()

    // 自定义连接：手填模型，密钥只进 Authorization 头（无模型拉取）。
    await studio.locator('[data-testid="add-provider"]').click()
    await chooseProviderOption(studio, 'provider-preset', 'custom')
    await studio.locator('[data-testid="provider-base-url"]').fill('https://example.com/v1')
    await chooseProviderOption(studio, 'provider-kind', 'chat')
    await studio.locator('[data-testid="provider-api-key"]').fill(FIRST_KEY)
    await studio.locator('[data-testid="provider-model-manual"]').fill('stub-chat')
    await studio.getByTestId('provider-submit').click()
    await expect(studio.getByRole('dialog')).toBeHidden()

    const providersAfterCreate = await readProviders(studio)
    const created = providersAfterCreate.find(
      (provider) => provider.adapter === 'openai-compatible' && provider.baseUrl === 'https://example.com/v1'
    )
    expect(created).toBeTruthy()
    const customCard = studio.locator(`[data-testid="provider-card"][data-provider-id="${created!.id}"]`)
    await expect(customCard).toBeVisible()
    await expect(customCard.getByTestId('provider-model-catalog')).toContainText('1 个')
    await expect(customCard.getByTestId('provider-selected-model')).toContainText('stub-chat（对话）')
    await expect(customCard.getByTestId('provider-secret-state')).toHaveAttribute('data-has-secret', 'true')
    await expect(customCard.getByText('已保存')).toBeVisible()
    await expect(customCard.getByText('已启用')).toBeVisible()
    const providerId = created!.id
    expect(existsSync(join(dataDir, 'electron-user-data', 'secrets', 'vault.json'))).toBe(true)

    const rawAfterCreate = await readRawProviders(studio)
    expect(rawAfterCreate).toContain('"hasSecret":true')
    expect(rawAfterCreate).toContain('"stub-chat"')
    expect(rawAfterCreate).not.toContain(FIRST_KEY)
    expect(rawAfterCreate).not.toContain(SECOND_KEY)
    expect(rawAfterCreate).not.toContain('"secretRef"')
    expect(rawAfterCreate).not.toContain('"apiKey"')

    // 轮换密钥：复用同一个连接 id 与稳定 vault label，不新增连接。
    await customCard.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(studio.locator('[data-testid="provider-preset"]')).toHaveCount(0)
    await expect(studio.getByTestId('provider-preset-readonly')).toHaveText('自定义')
    await expect(studio.getByTestId('provider-kind-readonly')).toHaveText('对话')
    await expect(studio.getByTestId('provider-kind')).toHaveCount(0)
    await expect(studio.getByTestId('provider-protocol-readonly')).toHaveText('OpenAI 兼容对话')
    await expect(studio.getByTestId('provider-api-key')).toHaveValue('••••••••')
    await studio.locator('[data-testid="provider-api-key"]').fill(SECOND_KEY)
    await studio.locator('[data-testid="provider-submit"]').click()
    await expect(studio.getByRole('dialog')).toBeHidden()
    await expect(studio.getByText('模型供应商已更新。')).toBeVisible()
    await expect(studio.locator('[data-testid="provider-card"]')).toHaveCount(3)
    await expect(
      studio.locator('[data-testid="provider-card"][data-provider-id="' + providerId + '"]')
    ).toBeVisible()
    await expect(customCard.getByTestId('provider-secret-state')).toHaveAttribute('data-has-secret', 'true')

    // 刷新后列表从服务端重建，密钥状态仍为 true。
    await studio.reload()
    await expect(studio.locator('[data-testid="providers-page"]')).toBeVisible({ timeout: 20_000 })
    await expect(
      studio
        .locator(`[data-testid="provider-card"][data-provider-id="${providerId}"]`)
        .getByTestId('provider-secret-state')
    ).toHaveAttribute('data-has-secret', 'true')

    // 停用与再次启用，均不带密钥、走 If-Match。
    const reloadedCard = studio.locator(`[data-testid="provider-card"][data-provider-id="${providerId}"]`)
    await reloadedCard.getByRole('button', { name: '停用', exact: true }).click()
    await expect(reloadedCard.getByText('已停用')).toBeVisible()
    await reloadedCard.getByRole('button', { name: '启用', exact: true }).click()
    await expect(reloadedCard.getByText('已启用')).toBeVisible()

    const rawAfterRotate = await readRawProviders(studio)
    const providers = JSON.parse(rawAfterRotate) as { items: ProviderJson[] }
    const custom = providers.items.find((provider) => provider.id === providerId)
    expect(custom).toMatchObject({ adapter: 'openai-compatible', enabled: true, hasSecret: true })
    expect(custom?.models.map((model) => model.id)).toEqual(['stub-chat'])
    expect(rawAfterRotate).not.toContain(FIRST_KEY)
    expect(rawAfterRotate).not.toContain(SECOND_KEY)
    expect(rawAfterRotate).not.toContain('"secretRef"')
    expect(rawAfterRotate).not.toContain('"apiKey"')

    const storage = await studio.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage }
      })
    )
    expect(storage).not.toContain(FIRST_KEY)
    expect(storage).not.toContain(SECOND_KEY)
    await expect(studio.locator('body')).not.toContainText(FIRST_KEY)
    await expect(studio.locator('body')).not.toContainText(SECOND_KEY)
  } finally {
    await app.close()
  }

  expect(findPlaintext(dataDir, FIRST_KEY)).toEqual([])
  expect(findPlaintext(dataDir, SECOND_KEY)).toEqual([])
})
