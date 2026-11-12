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
  Version?: unknown
  FileReferences?: unknown
}

interface FileReferences {
  Moc?: unknown
  Textures?: unknown
  Motions?: unknown
  Physics?: unknown
  Pose?: unknown
  Expressions?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function fail(model3: string | null, blocker: string): QcReport {
  return {
    pass: false,
    blockers: [blocker],
    warnings: [],
    model3,
    mocVersion: null,
    textures: 0,
    motions: {}
  }
}

export async function qcModelDirectory(dir: string, model3Name?: string): Promise<QcReport> {
  const blockers = new Set<string>()
  const warnings: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith('.model3.json'))
  } catch {
    return fail(null, 'B01')
  }
  const entry = model3Name ?? (entries.length === 1 ? entries[0]! : null)
  if (!entry) return fail(null, 'B01')
  let files: string
  try {
    files = readFileSync(join(dir, entry), 'utf8')
  } catch {
    return fail(entry, 'B01')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(files)
  } catch {
    return fail(entry, 'B01')
  }
  if (!isRecord(parsed)) return fail(entry, 'B01')
  const model3 = parsed as Model3

  let refs: FileReferences = {}
  if (model3.FileReferences !== undefined) {
    if (isRecord(model3.FileReferences)) refs = model3.FileReferences
    else blockers.add('B01')
  }
  if (!model3.Version || !isNonEmptyString(refs.Moc)) blockers.add('B01')
  const mocPath = isNonEmptyString(refs.Moc) ? resolveContainedFile(dir, refs.Moc) : null
  if (!mocPath) blockers.add('B03')
  let mocVersion: number | null = null
  if (mocPath) {
    try {
      const header = readFileSync(mocPath).subarray(0, 5)
      if (header.subarray(0, 4).toString('ascii') !== 'MOC3' || header[4] === undefined) {
        blockers.add('B02')
      } else {
        mocVersion = header[4]!
      }
    } catch {
      blockers.add('B03')
    }
  }

  let textures: string[] = []
  if (refs.Textures !== undefined) {
    if (!Array.isArray(refs.Textures)) {
      blockers.add('B01')
    } else {
      for (const texture of refs.Textures) {
        if (isNonEmptyString(texture)) textures.push(texture)
        else blockers.add('B03')
      }
    }
  }
  if (textures.length === 0) blockers.add('B06')

  const motionGroups: Record<string, unknown[]> = {}
  if (refs.Motions !== undefined) {
    if (!isRecord(refs.Motions)) {
      blockers.add('B01')
    } else {
      for (const [group, list] of Object.entries(refs.Motions)) {
        if (!Array.isArray(list)) {
          blockers.add('B01')
          continue
        }
        motionGroups[group] = list
        if (group.trim() === '') warnings.push('empty motion group name')
      }
    }
  }
  const motionRefs: string[] = []
  for (const list of Object.values(motionGroups)) {
    for (const motionEntry of list) {
      if (isRecord(motionEntry) && isNonEmptyString(motionEntry.File)) {
        motionRefs.push(motionEntry.File)
      } else {
        blockers.add('B03')
      }
    }
  }
  const idle = motionGroups.Idle
  if (
    !Array.isArray(idle) ||
    !idle.some((motionEntry) => isRecord(motionEntry) && isNonEmptyString(motionEntry.File))
  ) {
    blockers.add('B05')
  }

  const expressionRefs: string[] = []
  if (refs.Expressions !== undefined) {
    if (!Array.isArray(refs.Expressions)) {
      blockers.add('B01')
    } else {
      for (const expression of refs.Expressions) {
        if (isRecord(expression) && isNonEmptyString(expression.File)) {
          expressionRefs.push(expression.File)
        } else {
          blockers.add('B03')
        }
      }
    }
  }
  const physicsRefs: string[] = []
  if (refs.Physics !== undefined) {
    if (isNonEmptyString(refs.Physics)) physicsRefs.push(refs.Physics)
    else blockers.add('B01')
  }
  const poseRefs: string[] = []
  if (refs.Pose !== undefined) {
    if (isNonEmptyString(refs.Pose)) poseRefs.push(refs.Pose)
    else blockers.add('B01')
  }

  const allRefs = [...textures, ...motionRefs, ...expressionRefs, ...physicsRefs, ...poseRefs]
  for (const ref of allRefs) {
    if (!resolveContainedFile(dir, ref)) blockers.add('B03')
    if (ref.startsWith('/') || ref.includes('..') || ref.includes('\\')) blockers.add('B04')
  }
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
  return {
    pass: blockers.size === 0,
    blockers: [...blockers].sort(),
    warnings,
    model3: entry,
    mocVersion,
    textures: textures.length,
    motions: Object.fromEntries(Object.entries(motionGroups).map(([name, list]) => [name, list.length]))
  }
}
