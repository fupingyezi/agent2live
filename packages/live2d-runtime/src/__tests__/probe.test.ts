import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeMoc3, readCoreVersion } from '../probe'

function installFakeCore(version = 0x04020103) {
  const releaseMoc = vi.fn()
  const releaseModel = vi.fn()
  const fromArrayBuffer = vi.fn((buffer: ArrayBuffer) => ({ buffer, release: releaseMoc }))
  const fromMoc = vi.fn(() => ({
    parameters: { ids: ['ParamAngleX', 'ParamAngleY'], count: 2 },
    parts: { ids: ['PartArmA', 'PartArmB'] },
    drawables: { count: 7 },
    canvasinfo: { CanvasWidth: 2048, CanvasHeight: 1024 },
    release: releaseModel
  }))
  vi.stubGlobal('Live2DCubismCore', {
    Version: { csmGetVersion: () => version },
    Moc: { fromArrayBuffer },
    Model: { fromMoc }
  })
  return { releaseMoc, releaseModel, fromArrayBuffer, fromMoc }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readCoreVersion', () => {
  it('decodes the packed Core version', () => {
    installFakeCore(0x04020103)
    expect(readCoreVersion()).toBe('4.2.1.3')
  })

  it('returns null when the Core exposes no version', () => {
    vi.stubGlobal('Live2DCubismCore', {})
    expect(readCoreVersion()).toBeNull()
  })

  it('throws LIVE2D_CORE_MISSING when the Core is not loaded', () => {
    expect(() => readCoreVersion()).toThrow('LIVE2D_CORE_MISSING')
  })
})

describe('probeMoc3', () => {
  it('fetches the moc3 buffer and reports core model metadata', async () => {
    const fake = installFakeCore()
    const bytes = new Uint8Array([0x4d, 0x4f, 0x43, 0x33, 1])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes, { status: 200 }))
    )

    const probe = await probeMoc3('agent2live-model://models/Haru/Haru.moc3')

    expect(probe).toEqual({
      parameterIds: ['ParamAngleX', 'ParamAngleY'],
      partIds: ['PartArmA', 'PartArmB'],
      drawableCount: 7,
      canvasWidth: 2048,
      canvasHeight: 1024
    })
    expect(fake.fromArrayBuffer).toHaveBeenCalledTimes(1)
    expect(new Uint8Array(fake.fromArrayBuffer.mock.calls[0]![0])).toEqual(bytes)
    expect(fake.fromMoc).toHaveBeenCalledTimes(1)
    expect(fake.releaseModel).toHaveBeenCalledTimes(1)
    expect(fake.releaseMoc).toHaveBeenCalledTimes(1)
  })

  it('rejects when the moc3 request fails', async () => {
    installFakeCore()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 }))
    )
    await expect(probeMoc3('agent2live-model://models/Missing.moc3')).rejects.toThrow('MOCT_FETCH_FAILED_404')
  })

  it('releases the moc when Model.fromMoc throws', async () => {
    const releaseMoc = vi.fn()
    const fromMoc = vi.fn(() => {
      throw new Error('invalid moc')
    })
    vi.stubGlobal('Live2DCubismCore', {
      Moc: {
        fromArrayBuffer: vi.fn(() => ({ release: releaseMoc }))
      },
      Model: { fromMoc }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([0x4d, 0x4f, 0x43, 0x33]), { status: 200 }))
    )
    await expect(probeMoc3('agent2live-model://models/Broken.moc3')).rejects.toThrow('invalid moc')
    expect(fromMoc).toHaveBeenCalledTimes(1)
    expect(releaseMoc).toHaveBeenCalledTimes(1)
  })
})
