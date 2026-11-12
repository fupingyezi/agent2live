import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { qcModelDirectory } from '../qc-min'

async function makeModel(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'agent2live-qc-'))
  mkdirSync(join(dir, 'textures'))
  await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toFile(join(dir, 'textures', '0.png'))
  const moc = Buffer.alloc(64)
  moc.write('MOC3', 0, 'ascii')
  moc[4] = 1
  writeFileSync(join(dir, 'model.moc3'), moc)
  writeFileSync(join(dir, 'idle.motion3.json'), JSON.stringify({ Version: 3, Meta: {}, Curves: [] }))
  writeFileSync(
    join(dir, 'model.model3.json'),
    JSON.stringify({
      Version: 3,
      FileReferences: {
        Moc: 'model.moc3',
        Textures: ['textures/0.png'],
        Motions: { Idle: [{ File: 'idle.motion3.json' }] }
      }
    })
  )
  return dir
}

describe('QC minimal blockers', () => {
  it('passes a structurally complete model', async () => {
    const report = await qcModelDirectory(await makeModel())
    expect(report.blockers).toEqual([])
    expect(report.pass).toBe(true)
  })

  it('reports moc magic/version, missing refs, and missing idle', async () => {
    const dir = await makeModel()
    const moc = Buffer.alloc(64)
    writeFileSync(join(dir, 'model.moc3'), moc)
    const model3 = JSON.parse(readFileSync(join(dir, 'model.model3.json'), 'utf8'))
    model3.FileReferences.Textures = ['textures/missing.png']
    model3.FileReferences.Motions = {}
    writeFileSync(join(dir, 'model.model3.json'), JSON.stringify(model3))
    const report = await qcModelDirectory(dir)
    expect(report.pass).toBe(false)
    expect(report.blockers).toEqual(expect.arrayContaining(['B02', 'B03', 'B05']))
  })

  it('reports B01 when no model3 entry exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent2live-qc-empty-'))
    const report = await qcModelDirectory(dir)
    expect(report.pass).toBe(false)
    expect(report.blockers).toContain('B01')
  })
})
