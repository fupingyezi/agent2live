import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiClient } from './helpers/api'
import { waitForEndpoint } from './helpers/app'
import { studioPage } from './support/windows'

const SECOND_KEY = 'sk-e2e-rotated-do-not-leak'
const MODEL_STUB_SECRET = 'sk-e2e-model-stub-do-not-leak'

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

async function startModelStub(): Promise<{
  baseUrl: string
  close(): Promise<void>
  requests: Array<{ method: string; url: string; authorization: string | undefined }>
}> {
  const requests: Array<{ method: string; url: string; authorization: string | undefined }> = []
  const server = createServer((request, response) => {
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      authorization: request.headers.authorization
    })
    if (request.method === 'GET' && request.url === '/v1/models') {
      if (request.headers.authorization !== `Bearer ${MODEL_STUB_SECRET}`) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'unauthorized' } }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          data: [
            { id: 'stub-chat', name: 'Stub Chat', output_modalities: ['text'] },
            { id: 'stub-image', name: 'Stub Image', domain: 'ImageGeneration' }
          ]
        })
      )
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
  }
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

test('stores provider secrets in the vault and never exposes them through the API', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-providers-'))
  const stub = await startModelStub()
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
    await api.createMockImageProvider('Mock 生图')
    await api.createMockChatProvider('Mock 对话')
    await studio.reload()
    await expect(studio.locator('[data-testid="providers-page"]')).toBeVisible({ timeout: 20_000 })
    await expect(studio.locator('[data-testid="provider-card"]')).toHaveCount(2)

    const mockCard = studio.locator('[data-testid="provider-card"]').filter({ hasText: 'Mock 生图' })
    await expect(mockCard).toBeVisible()
    await expect(mockCard.getByText('无需密钥')).toBeVisible()
    await expect(mockCard.getByText('已启用')).toBeVisible()
    const mockChatCard = studio.locator('[data-testid="provider-card"]').filter({ hasText: 'Mock 对话' })
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

    // 固定服务商只暴露固定 Base URL，没有可编辑 URL / 模型选择，但可获取模型目录。
    await studio.locator('[data-testid="add-provider"]').click()
    const presetOptions = await studio
      .locator('[data-testid="provider-preset"] option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
    expect(presetOptions).toEqual(['deepseek-chat', 'zhipu-vision', 'volcengine-ark', 'custom'])
    await studio.locator('[data-testid="provider-preset"]').selectOption('volcengine-ark')
    await expect(studio.getByTestId('provider-fixed-base-url')).toContainText(
      'https://ark.cn-beijing.volces.com/api/v3'
    )
    await expect(studio.getByTestId('provider-base-url')).toHaveCount(0)
    await expect(studio.getByTestId('provider-fetch-models')).toBeVisible()
    await expect(studio.getByTestId('provider-model-select')).toHaveCount(0)
    await studio.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(studio.getByRole('dialog')).toBeHidden()

    // 自定义连接：目录来自 stub 的 /models，密钥只进 Authorization 头。
    await studio.locator('[data-testid="add-provider"]').click()
    await studio.locator('[data-testid="provider-preset"]').selectOption('custom')
    await studio.locator('[data-testid="provider-label"]').fill('E2E 自定义对话')
    await studio.locator('[data-testid="provider-base-url"]').fill(stub.baseUrl)
    await studio.locator('[data-testid="provider-kind"]').selectOption('chat')
    await studio.locator('[data-testid="provider-api-key"]').fill(MODEL_STUB_SECRET)
    await studio.locator('[data-testid="provider-fetch-models"]').click()
    await expect(studio.getByTestId('provider-model-counts')).toContainText('对话 1')
    await studio.getByTestId('provider-submit').click()
    await expect(studio.getByRole('dialog')).toBeHidden()

    const customCard = studio.locator('[data-testid="provider-card"]').filter({ hasText: 'E2E 自定义对话' })
    await expect(customCard).toBeVisible()
    await expect(customCard.getByTestId('provider-model-catalog')).toContainText('1 个模型')
    await expect(customCard.getByTestId('provider-secret-state')).toHaveAttribute('data-has-secret', 'true')
    await expect(customCard.getByText('已保存')).toBeVisible()
    await expect(customCard.getByText('已启用')).toBeVisible()
    const providerId = await customCard.getAttribute('data-provider-id')
    expect(providerId).toBeTruthy()
    expect(existsSync(join(dataDir, 'electron-user-data', 'secrets', 'vault.json'))).toBe(true)

    const rawAfterCreate = await readRawProviders(studio)
    expect(rawAfterCreate).toContain('"hasSecret":true')
    expect(rawAfterCreate).toContain('"stub-chat"')
    expect(rawAfterCreate).not.toContain(MODEL_STUB_SECRET)
    expect(rawAfterCreate).not.toContain(SECOND_KEY)
    expect(rawAfterCreate).not.toContain('"secretRef"')
    expect(rawAfterCreate).not.toContain('"apiKey"')

    // 编辑时 Key 留空刷新：服务端使用已保存的 Key，stub 必须收到 Bearer 头。
    await customCard.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(studio.locator('[data-testid="provider-preset"]')).toBeDisabled()
    const modelRequestsBeforeRefresh = stub.requests.filter((request) => request.url === '/v1/models').length
    await studio.getByTestId('provider-fetch-models').click()
    await expect
      .poll(() => stub.requests.filter((request) => request.url === '/v1/models').length)
      .toBeGreaterThan(modelRequestsBeforeRefresh)
    const modelRequestsAfterRefresh = stub.requests.filter((request) => request.url === '/v1/models')
    expect(modelRequestsAfterRefresh[modelRequestsAfterRefresh.length - 1]?.authorization).toBe(
      `Bearer ${MODEL_STUB_SECRET}`
    )
    await expect(studio.getByTestId('provider-model-counts')).toBeVisible()
    await expect(studio.getByText('模型目录已刷新。')).toBeVisible()
    await studio.getByTestId('provider-submit').click()
    await expect(studio.getByRole('dialog')).toBeHidden()

    // 轮换密钥：复用同一个连接 id 与稳定 vault label，不新增连接。
    await customCard.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(studio.locator('[data-testid="provider-preset"]')).toBeDisabled()
    await studio.locator('[data-testid="provider-api-key"]').fill(SECOND_KEY)
    await studio.locator('[data-testid="provider-submit"]').click()
    await expect(studio.getByRole('dialog')).toBeHidden()
    await expect(studio.getByText('连接已更新。')).toBeVisible()
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
    expect(rawAfterRotate).not.toContain(MODEL_STUB_SECRET)
    expect(rawAfterRotate).not.toContain(SECOND_KEY)
    expect(rawAfterRotate).not.toContain('"secretRef"')
    expect(rawAfterRotate).not.toContain('"apiKey"')

    const storage = await studio.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage }
      })
    )
    expect(storage).not.toContain(MODEL_STUB_SECRET)
    expect(storage).not.toContain(SECOND_KEY)
    await expect(studio.locator('body')).not.toContainText(MODEL_STUB_SECRET)
    await expect(studio.locator('body')).not.toContainText(SECOND_KEY)
  } finally {
    await stub.close()
    await app.close()
  }

  expect(findPlaintext(dataDir, MODEL_STUB_SECRET)).toEqual([])
  expect(findPlaintext(dataDir, SECOND_KEY)).toEqual([])
})
