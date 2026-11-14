import { describe, expect, it, vi } from 'vitest'
import {
  ProviderActivationError,
  ProviderFormError,
  buildCreateInput,
  createProviderFlow,
  updateProviderFlow,
  type ProviderConnectionRecord,
  type ProviderFlowPort
} from './create-flow'
import type { ProviderFormValues } from './presets'

function values(overrides: Partial<ProviderFormValues> = {}): ProviderFormValues {
  return {
    presetId: 'openai-chat',
    label: '主对话',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKey: 'sk-test-value',
    enabled: true,
    ...overrides
  }
}

function connection(overrides: Partial<ProviderConnectionRecord> = {}): ProviderConnectionRecord {
  return {
    id: 'conn_01J0000000000000000000000',
    label: '主对话',
    kind: 'chat',
    adapter: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    enabled: true,
    capabilities: {
      schemaVersion: 'provider-capabilities/1',
      chat: { maxImages: 8, maxPromptChars: 20_000, supportsVision: true }
    },
    hasSecret: true,
    createdAt: '2026-11-09T00:00:00.000Z',
    updatedAt: '2026-11-09T00:00:00.000Z',
    rowVersion: 1,
    ...overrides
  }
}

function makePort(overrides: Partial<ProviderFlowPort> = {}): ProviderFlowPort {
  return {
    create: vi.fn(async (input) =>
      connection({
        id: 'conn_01J0000000000000000000001',
        label: input.label,
        kind: input.kind,
        adapter: input.adapter,
        baseUrl: input.baseUrl ?? null,
        model: input.model ?? null,
        enabled: input.enabled,
        hasSecret: false
      })
    ),
    update: vi.fn(async (id, patch, rowVersion) =>
      connection({
        id,
        rowVersion: rowVersion + 1,
        ...patch,
        baseUrl: patch.baseUrl === undefined ? 'https://api.openai.com/v1' : patch.baseUrl,
        model: patch.model === undefined ? 'gpt-4.1-mini' : patch.model,
        enabled: patch.enabled ?? true,
        hasSecret: patch.secretRef === undefined ? true : Boolean(patch.secretRef)
      })
    ),
    get: vi.fn(async () => connection()),
    storeSecret: vi.fn(async () => ({ secretRef: 'sec_01J0000000000000000000002' })),
    ...overrides
  }
}

describe('buildCreateInput', () => {
  it('validates real endpoints and required key without leaking the key into the request', () => {
    const input = buildCreateInput(values())
    expect(input).toMatchObject({
      label: '主对话',
      kind: 'chat',
      adapter: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      enabled: false
    })
    expect(input).not.toHaveProperty('secretRef')
    expect(JSON.stringify(input)).not.toContain('sk-test-value')

    expect(() => buildCreateInput(values({ label: ' ' }))).toThrow(ProviderFormError)
    expect(() => buildCreateInput(values({ baseUrl: 'file:///tmp/key' }))).toThrow(ProviderFormError)
    expect(() => buildCreateInput(values({ apiKey: '' }))).toThrow(ProviderFormError)
    expect(() => buildCreateInput(values({ model: '' }))).toThrow(ProviderFormError)
  })

  it('creates mocks enabled even with an empty key', () => {
    const input = buildCreateInput(
      values({
        presetId: 'mock-image',
        label: 'Mock 生图',
        baseUrl: '',
        model: '',
        apiKey: ''
      })
    )
    expect(input).toMatchObject({ kind: 'image', adapter: 'mock', enabled: true })
    expect(input).not.toHaveProperty('baseUrl')
    expect(input).not.toHaveProperty('model')
  })
})

describe('createProviderFlow', () => {
  it('creates a real provider disabled, stores the key under a stable label, then activates it', async () => {
    const created = connection({
      id: 'conn_01J0000000000000000000001',
      enabled: false,
      hasSecret: false,
      rowVersion: 1
    })
    const activated = connection({ id: created.id, enabled: true, hasSecret: true, rowVersion: 2 })
    const port = makePort({
      create: vi.fn(async () => created),
      update: vi.fn(async () => activated)
    })

    const result = await createProviderFlow(port, values())

    expect(port.create).toHaveBeenCalledTimes(1)
    expect(port.create).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    expect(port.storeSecret).toHaveBeenCalledWith({
      label: `provider-secret:${created.id}`,
      value: 'sk-test-value'
    })
    expect(port.update).toHaveBeenCalledWith(
      created.id,
      {
        secretRef: 'sec_01J0000000000000000000002',
        enabled: true
      },
      1
    )
    expect(result).toEqual(activated)
  })

  it('uses one POST for mock providers and never touches the vault', async () => {
    const mock = connection({
      id: 'conn_01J0000000000000000000003',
      kind: 'image',
      adapter: 'mock',
      baseUrl: null,
      model: null,
      enabled: true,
      hasSecret: false
    })
    const port = makePort({ create: vi.fn(async () => mock) })
    const result = await createProviderFlow(
      port,
      values({
        presetId: 'mock-image',
        label: 'Mock 生图',
        baseUrl: '',
        model: '',
        apiKey: ''
      })
    )
    expect(result).toEqual(mock)
    expect(port.storeSecret).not.toHaveBeenCalled()
    expect(port.update).not.toHaveBeenCalled()
  })

  it('recovers when activation succeeded but the response was lost', async () => {
    const created = connection({
      id: 'conn_01J0000000000000000000004',
      enabled: false,
      hasSecret: false,
      rowVersion: 1
    })
    const active = connection({ id: created.id, enabled: true, hasSecret: true, rowVersion: 2 })
    const port = makePort({
      create: vi.fn(async () => created),
      update: vi.fn(async () => {
        throw new Error('network reset')
      }),
      get: vi.fn(async () => active)
    })
    await expect(createProviderFlow(port, values())).resolves.toEqual(active)
  })

  it('reports a partial failure with the provider id instead of retrying blindly', async () => {
    const created = connection({
      id: 'conn_01J0000000000000000000005',
      enabled: false,
      hasSecret: false,
      rowVersion: 1
    })
    const port = makePort({
      create: vi.fn(async () => created),
      update: vi.fn(async () => {
        throw new Error('invalid secret reference')
      }),
      get: vi.fn(async () => created)
    })
    await expect(createProviderFlow(port, values())).rejects.toMatchObject({
      name: 'ProviderActivationError',
      providerId: created.id
    })
    await expect(createProviderFlow(port, values())).rejects.toBeInstanceOf(ProviderActivationError)
  })
})

describe('updateProviderFlow', () => {
  it('preserves the existing secret when the key field is blank and patches only changed fields', async () => {
    const current = connection({ rowVersion: 4 })
    const port = makePort({
      update: vi.fn(async () => connection({ label: '主对话（新）', rowVersion: 5 }))
    })
    await updateProviderFlow(port, current, values({ label: '主对话（新）', apiKey: '' }))

    expect(port.storeSecret).not.toHaveBeenCalled()
    expect(port.update).toHaveBeenCalledWith(current.id, { label: '主对话（新）' }, 4)
  })

  it('rotates a key through the same stable label and keeps the connection id', async () => {
    const current = connection({ rowVersion: 7 })
    const port = makePort({
      update: vi.fn(async () => connection({ hasSecret: true, rowVersion: 8 }))
    })
    await updateProviderFlow(port, current, values({ apiKey: 'sk-rotated-value' }))

    expect(port.storeSecret).toHaveBeenCalledWith({
      label: `provider-secret:${current.id}`,
      value: 'sk-rotated-value'
    })
    expect(port.update).toHaveBeenCalledWith(
      current.id,
      {
        secretRef: 'sec_01J0000000000000000000002'
      },
      7
    )
  })

  it('refuses to enable a real provider with no existing secret and no new key', async () => {
    const current = connection({ enabled: false, hasSecret: false, rowVersion: 2 })
    const port = makePort()
    await expect(
      updateProviderFlow(port, current, values({ apiKey: '', enabled: true }))
    ).rejects.toMatchObject({ name: 'ProviderFormError', fields: { apiKey: expect.any(String) } })
    expect(port.storeSecret).not.toHaveBeenCalled()
    expect(port.update).not.toHaveBeenCalled()
  })

  it('can disable without a key and returns the current record when nothing changed', async () => {
    const current = connection({ enabled: true, rowVersion: 3 })
    const disabled = connection({ enabled: false, rowVersion: 4 })
    const port = makePort({ update: vi.fn(async () => disabled) })
    await expect(updateProviderFlow(port, current, values({ apiKey: '', enabled: false }))).resolves.toEqual(
      disabled
    )
    expect(port.update).toHaveBeenCalledWith(current.id, { enabled: false }, 3)

    const noopPort = makePort()
    await expect(
      updateProviderFlow(noopPort, current, values({ apiKey: '', enabled: true }))
    ).resolves.toEqual(current)
    expect(noopPort.update).not.toHaveBeenCalled()
  })
})
