import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

export interface ModelMeta {
  model3Version: number | null
  moc3File: string
  moc3Magic: string
  moc3Version: number
  moc3VersionRaw: number
}

export function readModelMeta(model3Path: string): ModelMeta {
  const json = JSON.parse(readFileSync(model3Path, 'utf8')) as {
    Version?: unknown
    FileReferences?: { Moc?: unknown }
  }
  const moc = json.FileReferences?.Moc
  if (typeof moc !== 'string' || moc.length === 0) throw new Error('MODEL_MOC_REFERENCE_MISSING')
  const moc3File = isAbsolute(moc) ? moc : resolve(dirname(model3Path), moc)
  const header = readFileSync(moc3File).subarray(0, 8)
  const magic = header.subarray(0, 4).toString('ascii')
  if (magic !== 'MOC3' || header.length < 8) throw new Error('MOC3_MAGIC_INVALID')
  const raw = header.readUInt32BE(4)
  return {
    model3Version: typeof json.Version === 'number' ? json.Version : null,
    moc3File,
    moc3Magic: magic,
    moc3Version: raw >>> 24,
    moc3VersionRaw: raw
  }
}
