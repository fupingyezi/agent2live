import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
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

  it('rejects an existing allowlisted file outside the root because of containment', () => {
    const root = fixture()
    const outsideDir = mkdtempSync(join(tmpdir(), 'agent2live-outside-dir-'))
    writeFileSync(join(outsideDir, 'secret.png'), 'outside')
    const traversal = relative(root, join(outsideDir, 'secret.png'))
    expect(traversal.startsWith('..')).toBe(true)
    expect(resolveContainedFile(root, traversal)).toBeNull()
  })

  it('rejects an absolute path to an existing allowlisted file', () => {
    const root = fixture()
    const absolute = join(root, 'Haru', 'textures', '0.png')
    expect(resolveContainedFile(root, absolute)).toBeNull()
  })

  it('rejects a literal backslash-named file that exists inside the root', () => {
    const root = fixture()
    writeFileSync(join(root, 'Haru\\..\\secret.png'), 'inside')
    expect(resolveContainedFile(root, 'Haru\\..\\secret.png')).toBeNull()
  })

  it('rejects a NUL character without throwing', () => {
    const root = fixture()
    expect(resolveContainedFile(root, 'Haru/\0.png')).toBeNull()
  })

  it('rejects an interior .. segment even when it stays inside the root', () => {
    const root = fixture()
    expect(resolveContainedFile(root, 'Haru/../Haru/Haru.model3.json')).toBeNull()
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

  it('rejects encoded dot-segments and NUL before URL normalization', () => {
    expect(modelPathFromUrl('agent2live-model://models/%2e%2e/%2e%2e/secret.png')).toBeNull()
    expect(modelPathFromUrl('agent2live-model://models/Haru/%00.png')).toBeNull()
    expect(modelPathFromUrl('agent2live-model://models/Haru/../Haru/Haru.model3.json')).toBeNull()
  })
})
