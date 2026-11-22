import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { newId } from '@agent2live/contracts'

export interface VaultCrypto {
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface VaultEntry {
  secretRef: string
  label: string
  ciphertext: string
  createdAt: number
  updatedAt: number
}

export interface VaultState {
  schemaVersion: 'secret-vault/1'
  entries: VaultEntry[]
}

export function createVaultState(): VaultState {
  return { schemaVersion: 'secret-vault/1', entries: [] }
}

export function addSecret(
  state: VaultState,
  input: { label: string; value: string; ref?: string; crypto: VaultCrypto; now?: number }
): VaultState {
  if (!input.value) throw new Error('SECRET_EMPTY')
  if (input.value.length > 8192) throw new Error('SECRET_TOO_LARGE')
  const now = input.now ?? Date.now()
  const secretRef = input.ref ?? newId('secretRef')
  const existing = input.ref ? state.entries.find((item) => item.secretRef === input.ref) : undefined
  const entry: VaultEntry = {
    secretRef,
    label: input.label.slice(0, 80),
    ciphertext: input.crypto.encryptString(input.value).toString('base64'),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  return {
    ...state,
    entries: [...state.entries.filter((item) => item.secretRef !== secretRef), entry]
  }
}

export function readSecret(state: VaultState, secretRef: string, crypto: VaultCrypto): string | null {
  const entry = state.entries.find((item) => item.secretRef === secretRef)
  if (!entry) return null
  return crypto.decryptString(Buffer.from(entry.ciphertext, 'base64'))
}

export function deleteSecret(state: VaultState, secretRef: string): VaultState {
  return { ...state, entries: state.entries.filter((entry) => entry.secretRef !== secretRef) }
}

export class VaultFile {
  constructor(
    private readonly file: string,
    private readonly crypto: VaultCrypto
  ) {}

  load(): VaultState {
    try {
      const raw = readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as VaultState
      if (parsed.schemaVersion !== 'secret-vault/1' || !Array.isArray(parsed.entries)) {
        throw new Error('bad vault')
      }
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return createVaultState()
      throw new Error('SECRET_VAULT_UNREADABLE')
    }
  }

  save(state: VaultState): void {
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
      const fd = openSync(temp, 'w', 0o600)
      try {
        writeSync(fd, JSON.stringify(state, null, 2))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temp, this.file)
    } catch {
      try {
        rmSync(temp, { force: true })
      } catch {
        // Temp cleanup is best effort; the existing vault is left untouched.
      }
      // Filesystem errors embed the vault path; never let that reach callers.
      throw new Error('SECRET_VAULT_WRITE_FAILED')
    }
  }

  put(label: string, value: string): { secretRef: string } {
    const state = this.load()
    const normalized = label.slice(0, 80)
    const existing = state.entries.find((entry) => entry.label === normalized)
    const secretRef = existing?.secretRef ?? newId('secretRef')
    const next = addSecret(state, { label: normalized, value, ref: secretRef, crypto: this.crypto })
    this.save(next)
    return { secretRef }
  }

  resolve(secretRef: string): string | null {
    return readSecret(this.load(), secretRef, this.crypto)
  }

  delete(secretRef: string): void {
    this.save(deleteSecret(this.load(), secretRef))
  }

  deleteByLabelPrefix(prefix: string): void {
    const state = this.load()
    const entries = state.entries.filter((entry) => !entry.label.startsWith(prefix))
    if (entries.length === state.entries.length) return
    this.save({ ...state, entries })
  }

  has(secretRef: string): boolean {
    return this.load().entries.some((entry) => entry.secretRef === secretRef)
  }
}
