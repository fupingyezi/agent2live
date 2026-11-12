import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readModelMeta } from './model-meta'

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-model-meta-'))
  mkdirSync(join(dir, 'textures'), { recursive: true })
  writeFileSync(join(dir, 'textures', 'tex.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(dir, 'sample.moc3'), Buffer.from([0x4d, 0x4f, 0x43, 0x33, 0x05, 0x00, 0x00, 0x00, 0x00]))
  writeFileSync(
    join(dir, 'sample.model3.json'),
    JSON.stringify({
      Version: 3,
      FileReferences: {
        Moc: 'sample.moc3',
        Textures: ['textures/tex.png']
      }
    })
  )
  return dir
}

describe('readModelMeta', () => {
  it('reads model3 version, moc reference, and moc3 major version', () => {
    const dir = fixtureDir()
    const meta = readModelMeta(join(dir, 'sample.model3.json'))
    expect(meta.model3Version).toBe(3)
    expect(meta.moc3File).toBe(join(dir, 'sample.moc3'))
    expect(meta.moc3Version).toBe(5)
    expect(meta.moc3VersionRaw).toBe(0x05000000)
    expect(meta.moc3Magic).toBe('MOC3')
  })

  it('rejects a missing Moc reference', () => {
    const dir = fixtureDir()
    writeFileSync(join(dir, 'broken.model3.json'), JSON.stringify({ Version: 3, FileReferences: {} }))
    expect(() => readModelMeta(join(dir, 'broken.model3.json'))).toThrow('MODEL_MOC_REFERENCE_MISSING')
  })

  it('rejects a wrong magic header', () => {
    const dir = fixtureDir()
    writeFileSync(join(dir, 'sample.moc3'), Buffer.from('NOPE0000', 'ascii'))
    expect(() => readModelMeta(join(dir, 'sample.model3.json'))).toThrow('MOC3_MAGIC_INVALID')
  })
})
