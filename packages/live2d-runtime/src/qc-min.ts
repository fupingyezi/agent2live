import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { resolveContainedFile } from './protocol'

export interface QcReport {
  pass: boolean
  blockers: string[]
  warnings: string[]
  model3: string | null
  mocVersion: number | null
  textures: number
  motions: Record<string, number>
}

interface Model3 {
  Version?: number
  FileReferences?: {
    Moc?: string
    Textures?: string[]
    Motions?: Record<string, Array<{ File?: string }>>
    Physics?: string
    Pose?: string
    Expressions?: Array<{ File?: string }>
  }
}

export async function qcModelDirectory(dir: string, model3Name?: string): Promise<QcReport> {
  const blockers = new Set<string>()
  const warnings: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith('.model3.json'))
  } catch {
    return {
      pass: false,
      blockers: ['B01'],
      warnings,
      model3: null,
      mocVersion: null,
      textures: 0,
      motions: {}
    }
  }
  const entry = model3Name ?? (entries.length === 1 ? entries[0]! : null)
  if (!entry) {
    return {
      pass: false,
      blockers: ['B01'],
      warnings,
      model3: null,
      mocVersion: null,
      textures: 0,
      motions: {}
    }
  }
  let files: string
  try {
    files = readFileSync(join(dir, entry), 'utf8')
  } catch {
    return {
      pass: false,
      blockers: ['B01'],
      warnings,
      model3: entry,
      mocVersion: null,
      textures: 0,
      motions: {}
    }
  }
  let model3: Model3
  try {
    model3 = JSON.parse(files) as Model3
  } catch {
    return {
      pass: false,
      blockers: ['B01'],
      warnings,
      model3: entry,
      mocVersion: null,
      textures: 0,
      motions: {}
    }
  }
  const refs = model3.FileReferences ?? {}
  if (!refs.Moc || !model3.Version) blockers.add('B01')
  const mocPath = refs.Moc ? resolveContainedFile(dir, refs.Moc) : null
  if (!mocPath) blockers.add('B03')
  let mocVersion: number | null = null
  if (mocPath) {
    const header = readFileSync(mocPath).subarray(0, 5)
    if (header.subarray(0, 4).toString('ascii') !== 'MOC3' || header[4] === undefined) blockers.add('B02')
    else mocVersion = header[4]
  }
  const allRefs = [
    ...(refs.Textures ?? []),
    ...Object.values(refs.Motions ?? {})
      .flat()
      .map((m) => m.File)
      .filter((x): x is string => Boolean(x)),
    ...(refs.Expressions ?? []).map((e) => e.File).filter((x): x is string => Boolean(x)),
    ...(refs.Physics ? [refs.Physics] : []),
    ...(refs.Pose ? [refs.Pose] : [])
  ]
  for (const ref of allRefs) {
    if (!resolveContainedFile(dir, ref)) blockers.add('B03')
    if (ref.startsWith('/') || ref.includes('..') || ref.includes('\\')) blockers.add('B04')
  }
  const textures = refs.Textures ?? []
  if (textures.length === 0) blockers.add('B06')
  for (const texture of textures) {
    const path = resolveContainedFile(dir, texture)
    if (!path) continue
    try {
      const meta = await sharp(path).metadata()
      if (!meta.width || !meta.height || meta.width > 8192 || meta.height > 8192) blockers.add('B06')
    } catch {
      blockers.add('B06')
    }
  }
  const motions = refs.Motions ?? {}
  if (!Array.isArray(motions.Idle) || motions.Idle.length === 0) blockers.add('B05')
  for (const [group, list] of Object.entries(motions)) {
    if (list.some((entry) => !entry.File || !existsSync(join(dir, entry.File)))) blockers.add('B03')
    if (group.trim() === '') warnings.push('empty motion group name')
  }
  return {
    pass: blockers.size === 0,
    blockers: [...blockers].sort(),
    warnings,
    model3: entry,
    mocVersion,
    textures: textures.length,
    motions: Object.fromEntries(Object.entries(motions).map(([name, list]) => [name, list.length]))
  }
}
