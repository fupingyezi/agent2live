import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd } from 'ag-psd'
import { FIXTURE_HEIGHT, FIXTURE_LAYER_NAMES, FIXTURE_WIDTH, buildFixturePsd } from './lib/fixture'

// ag-psd allocates ImageData through a canvas unless a pure-JS factory is registered.
// This keeps the fixture check free of node-canvas while still decoding layer pixels.
initializeCanvas(
  (width, height) =>
    ({
      width,
      height,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4)
        })
      })
    }) as unknown as HTMLCanvasElement,
  (width, height) =>
    ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4)
    }) as unknown as ImageData
)

describe('synthetic PSD fixture', () => {
  it('writes a transparent 8-bit layered PSD without node-canvas', () => {
    const bytes = buildFixturePsd({ naming: 'upper' })
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('8BPS')

    const psd = readPsd(bytes, {
      useImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true
    })
    expect(psd.width).toBe(FIXTURE_WIDTH)
    expect(psd.height).toBe(FIXTURE_HEIGHT)
    expect(psd.children?.map((child) => child.name)).toEqual(FIXTURE_LAYER_NAMES('upper'))
    expect(psd.children?.length).toBe(20)

    const face = psd.children?.find((child) => child.name === 'FACE')
    expect(face?.imageData).toBeDefined()
    expect(face!.imageData!.data[3]).toBe(0)
    const faceCenter = (440 * FIXTURE_WIDTH + 400) * 4 + 3
    expect(face!.imageData!.data[faceCenter]).toBeGreaterThan(0)
  })

  it('supports lowercase tag naming as a fallback', () => {
    const names = FIXTURE_LAYER_NAMES('lower')
    expect(names).toContain('eyelash-l')
    expect(names).toContain('back_hair')
  })
})
