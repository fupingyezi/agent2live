import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { studioPage } from './support/windows'

const FIRST_KEY = 'sk-e2e-secret-do-not-leak'
const SECOND_KEY = 'sk-e2e-rotated-do-not-leak'

interface ProviderJson {
  id: string
  label: string
  adapter: string
  enabled: boolean
  hasSecret: boolean
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

test('stores provider secrets in the vault and never exposes them through the API', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'agent2live-providers-'))
  const app = await electron.launch({
    args: ['apps/desktop/out/main/index.js'],
    env: { ...process.env, AGENT2LIVE_DATA_DIR: dataDir, AGENT2LIVE_E2E: '1' }
  })

  try {
    const studio = await studioPage(app)
    await expect(studio.locator('[data-testid="studio-ready"]')).toBeVisible()
    await expect(studio.locator('[data-testid="sse-status"]')).toContainText('实时已连接', {
      timeout: 20_000
    })

    await studio.getByRole('button', { name: '模型连接', exact: true }).click()
    await expect(studio.locator('[data-testid="providers-page"]')).toBeVisible()
    await expect(studio.locator('[data-testid="providers-empty"]')).toBeVisible()

    // Mock 连接：单次 POST、无密钥、立即启用。
    await studio.locator('[data-testid="add-provider"]').click()
    await studio.locator('[data-testid="provider-preset"]').selectOption('mock-image')
    await expect(studio.locator('[data-testid="provider-label"]')).toHaveValue('Mock 生图')
    await expect(studio.locator('[data-testid="provider-api-key"]')).toHaveCount(0)
    await studio.locator('[data-testid="provider-submit"]').click()

    const mockCard = studio.locator('[data-testid="provider-card"]').filter({ hasText: 'Mock 生图' })
    await expect(mockCard).toBeVisible()
    await expect(mockCard.getByText('无需密钥')).toBeVisible()
    await expect(mockCard.getByText('已启用')).toBeVisible()

    // 真实连接：先建 disabled 行，再存密钥，再 PATCH 激活。
    await studio.locator('[data-testid="add-provider"]').click()
    await studio.locator('[data-testid="provider-preset"]').selectOption('seedream-image')
    await expect(studio.locator('[data-testid="provider-base-url"]')).toHaveValue(
      'https://ark.cn-beijing.volces.com/api/v3'
    )
    await expect(studio.locator('[data-testid="provider-model"]')).toHaveValue('doubao-seedream-4-0-250828')
    await expect(studio.locator('[data-testid="provider-api-key"]')).toHaveAttribute('type', 'password')
    await studio.locator('[data-testid="provider-api-key"]').fill(FIRST_KEY)
    await studio.locator('[data-testid="provider-submit"]').click()

    const seedreamCard = studio.locator('[data-testid="provider-card"]').filter({ hasText: 'Seedream 生图' })
    await expect(seedreamCard).toBeVisible()
    await expect(seedreamCard.getByTestId('provider-secret-state')).toHaveAttribute('data-has-secret', 'true')
    await expect(seedreamCard.getByText('密钥已保存在系统钥匙串')).toBeVisible()
    await expect(seedreamCard.getByText('已启用')).toBeVisible()
    const providerId = await seedreamCard.getAttribute('data-provider-id')
    expect(providerId).toBeTruthy()
    expect(existsSync(join(dataDir, 'electron-user-data', 'secrets', 'vault.json'))).toBe(true)

    const rawAfterCreate = await studio.evaluate(async () => {
      const bridge = (
        window as unknown as {
          agent2live: { getServerInfo(): Promise<{ baseUrl: string; token: string }> }
        }
      ).agent2live
      const info = await bridge.getServerInfo()
      const response = await fetch(`${info.baseUrl}/api/v1/providers`, {
        headers: { authorization: `Bearer ${info.token}`, accept: 'application/json' }
      })
      return await response.text()
    })
    expect(rawAfterCreate).toContain('"hasSecret":true')
    expect(rawAfterCreate).not.toContain(FIRST_KEY)
    expect(rawAfterCreate).not.toContain('"secretRef"')
    expect(rawAfterCreate).not.toContain('"apiKey"')

    // 轮换密钥：复用同一个连接 id 与稳定 vault label，不新增连接。
    await seedreamCard.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(studio.locator('[data-testid="provider-preset"]')).toBeDisabled()
    await studio.locator('[data-testid="provider-api-key"]').fill(SECOND_KEY)
    await studio.locator('[data-testid="provider-submit"]').click()
    await expect(studio.getByText('连接与密钥已更新。')).toBeVisible()
    await expect(studio.locator('[data-testid="provider-card"]')).toHaveCount(2)
    await expect(
      studio.locator('[data-testid="provider-card"][data-provider-id="' + providerId + '"]')
    ).toBeVisible()

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

    const rawAfterRotate = await studio.evaluate(async () => {
      const bridge = (
        window as unknown as {
          agent2live: { getServerInfo(): Promise<{ baseUrl: string; token: string }> }
        }
      ).agent2live
      const info = await bridge.getServerInfo()
      const response = await fetch(`${info.baseUrl}/api/v1/providers`, {
        headers: { authorization: `Bearer ${info.token}`, accept: 'application/json' }
      })
      return await response.text()
    })
    const providers = JSON.parse(rawAfterRotate) as { items: ProviderJson[] }
    const seedream = providers.items.find((provider) => provider.id === providerId)
    expect(seedream).toMatchObject({ adapter: 'seedream', enabled: true, hasSecret: true })
    expect(rawAfterRotate).not.toContain(FIRST_KEY)
    expect(rawAfterRotate).not.toContain(SECOND_KEY)

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
