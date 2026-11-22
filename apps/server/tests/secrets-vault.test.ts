import { chmodSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VaultFile, addSecret, createVaultState, readSecret } from '../../desktop/src/main/vault'

const crypto = {
  encryptString: (value: string) => Buffer.from(`enc:${value}`),
  decryptString: (value: Buffer) => Buffer.from(value.toString().slice(4)).toString()
}

describe('secret vault', () => {
  it('encrypts and decrypts vault entries and never stores plaintext', () => {
    let state = createVaultState()
    state = addSecret(state, {
      label: 'seedream',
      value: 'sk-abc',
      ref: 'sec_01J00000000000000000000000',
      crypto,
      now: 100
    })
    expect(JSON.stringify(state)).not.toContain('sk-abc')
    expect(readSecret(state, 'sec_01J00000000000000000000000', crypto)).toBe('sk-abc')
  })

  it('rotates by stable label, preserves the secret ref and createdAt, and keeps one entry', () => {
    let state = createVaultState()
    state = addSecret(state, {
      label: 'provider-secret:conn_01J00000000000000000000000',
      value: 'sk-old',
      ref: 'sec_01J00000000000000000000000',
      crypto,
      now: 100
    })
    state = addSecret(state, {
      label: 'provider-secret:conn_01J00000000000000000000000',
      value: 'sk-new',
      ref: 'sec_01J00000000000000000000000',
      crypto,
      now: 200
    })
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({
      secretRef: 'sec_01J00000000000000000000000',
      createdAt: 100,
      updatedAt: 200
    })
    expect(readSecret(state, 'sec_01J00000000000000000000000', crypto)).toBe('sk-new')
  })

  it('VaultFile.put reuses the ref for the same label and writes only ciphertext', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent2live-vault-'))
    const file = join(dir, 'vault.json')
    const vault = new VaultFile(file, crypto)
    const first = vault.put('provider-secret:conn_01J00000000000000000000000', 'sk-old')
    const second = vault.put('provider-secret:conn_01J00000000000000000000000', 'sk-new')
    expect(second.secretRef).toBe(first.secretRef)
    expect(vault.resolve(first.secretRef)).toBe('sk-new')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('sk-old')
    expect(raw).not.toContain('sk-new')
    expect(JSON.parse(raw).entries).toHaveLength(1)
  })

  it('deletes only entries whose label starts with the draft prefix', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'vault-draft-')), 'vault.json')
    const vault = new VaultFile(file, crypto)
    const stable = vault.put('provider-secret:conn_1', 'sk-stable')
    const draft = vault.put('provider-draft:abc', 'sk-draft')
    vault.deleteByLabelPrefix('provider-draft:')
    expect(vault.resolve(stable.secretRef)).toBe('sk-stable')
    expect(vault.resolve(draft.secretRef)).toBeNull()
    expect(readFileSync(file, 'utf8')).not.toContain('sk-stable')
    expect(readFileSync(file, 'utf8')).not.toContain('sk-draft')
  })

  it('VaultFile.put fails without overwriting the vault and without leaking its path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent2live-vault-'))
    const file = join(dir, 'vault.json')
    const vault = new VaultFile(file, crypto)
    vault.put('provider-secret:conn_01J00000000000000000000000', 'sk-old')
    const before = readFileSync(file, 'utf8')
    let error: unknown
    chmodSync(dir, 0o500)
    try {
      vault.put('provider-secret:conn_01J00000000000000000000000', 'sk-new')
      throw new Error('expected put to fail')
    } catch (caught) {
      error = caught
    } finally {
      chmodSync(dir, 0o700)
    }
    expect((error as Error).message).toBe('SECRET_VAULT_WRITE_FAILED')
    expect(String(error)).not.toContain(dir)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})
