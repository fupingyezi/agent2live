import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentTypeFor, modelPathFromUrl, resolveContainedFile } from '../protocol'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent2live-model-root-'))
  mkdirSync(join(root, 'Haru', 'textures'), { recursive: true })
  writeFileSync(join(root, 'Haru', 'Haru.model3.json'), '{}')
  writeFileSync(join(root, 'Haru', 'textures', '0.png'), 'not-a-real-png')
  writeFileSync(join(root, 'secret.txt'), 'secret')
  return root
}

describe('model protocol path containment', () => {
  it('resolves contained files and content types', () => {
    const root = fixture()
    expect(resolveContainedFile(root, 'Haru/Haru.model3.json')).toBe(join(root, 'Haru', 'Haru.model3.json'))
    expect(contentTypeFor('Haru/Haru.model3.json')).toBe('application/json')
    expect(contentTypeFor('Haru/textures/0.png')).toBe('image/png')
  })

  it('rejects traversal, absolute paths, NUL, backslashes, and allowlist violations', () => {
    const root = fixture()
    expect(resolveContainedFile(root, '../secret.txt')).toBeNull()
    expect(resolveContainedFile(root, '/etc/passwd')).toBeNull()
    expect(resolveContainedFile(root, 'Haru/%00.json')).toBeNull()
    expect(resolveContainedFile(root, 'Haru\\..\\secret.txt')).toBeNull()
    expect(resolveContainedFile(root, 'secret.txt')).toBeNull()
  })

  it('rejects symlinks that escape the model root', () => {
    const root = fixture()
    const outside = join(tmpdir(), `agent2live-outside-${Date.now()}.png`)
    writeFileSync(outside, 'outside')
    symlinkSync(outside, join(root, 'Haru', 'escape.png'))
    expect(resolveContainedFile(root, 'Haru/escape.png')).toBeNull()
  })

  it('rejects a missing model root and a non-directory model root', () => {
    const missing = join(tmpdir(), `agent2live-missing-${Date.now()}`)
    expect(resolveContainedFile(missing, 'Haru/Haru.model3.json')).toBeNull()
    const fileRoot = join(tmpdir(), `agent2live-root-file-${Date.now()}`)
    writeFileSync(fileRoot, '{}')
    expect(resolveContainedFile(fileRoot, 'Haru/Haru.model3.json')).toBeNull()
  })
})

describe('model request URL parsing', () => {
  it('extracts a relative path from agent2live-model URLs', () => {
    expect(modelPathFromUrl('agent2live-model://models/Haru/Haru.model3.json')).toBe('Haru/Haru.model3.json')
    expect(modelPathFromUrl('agent2live-model://models/Haru/Haru%20model3.json')).toBe(
      'Haru/Haru model3.json'
    )
  })

  it('returns null for malformed percent-encoding, wrong hosts, and invalid URLs', () => {
    expect(modelPathFromUrl('agent2live-model://models/%E0%A4%A')).toBeNull()
    expect(modelPathFromUrl('agent2live-model://localhost/Haru/Haru.model3.json')).toBeNull()
    expect(modelPathFromUrl('https://models/Haru/Haru.model3.json')).toBeNull()
    expect(modelPathFromUrl('not a url')).toBeNull()
    expect(modelPathFromUrl('agent2live-model://models/')).toBeNull()
  })
})
