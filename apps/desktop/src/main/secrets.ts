import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { VaultFile, type VaultCrypto } from './vault'

let vault: VaultFile | null = null

export function getSecretVault(): VaultFile {
  if (vault) return vault
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('SECRET_STORAGE_UNAVAILABLE')
  }
  const crypto: VaultCrypto = {
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value)
  }
  vault = new VaultFile(join(app.getPath('userData'), 'secrets', 'vault.json'), crypto)
  return vault
}

export function cleanupDraftSecrets(): void {
  try {
    getSecretVault().deleteByLabelPrefix('provider-draft:')
  } catch (error) {
    // 启动清理失败不影响应用启动；草稿密钥仍是加密存储。
    console.error('failed to clean provider draft secrets', error)
  }
}
