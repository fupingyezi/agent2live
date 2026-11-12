import { writePsdBuffer, type Layer } from 'ag-psd'

export type Naming = 'upper' | 'lower'
export const FIXTURE_WIDTH = 800
export const FIXTURE_HEIGHT = 1000

type RGBA = readonly [number, number, number, number]
interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

interface RasterLayer {
  tag: string
  side?: 'l' | 'r'
  draw(raster: Raster): void
}

const W = FIXTURE_WIDTH
const H = FIXTURE_HEIGHT

const COLORS = {
  backHair: [80, 53, 40, 255] as RGBA,
  frontHair: [107, 74, 55, 255] as RGBA,
  skin: [246, 205, 176, 255] as RGBA,
  skinShadow: [237, 187, 154, 255] as RGBA,
  blush: [232, 138, 138, 180] as RGBA,
  eyelash: [42, 32, 28, 255] as RGBA,
  eyebrow: [59, 42, 34, 255] as RGBA,
  eyewhite: [255, 255, 255, 255] as RGBA,
  iris: [74, 122, 128, 255] as RGBA,
  mouth: [181, 82, 74, 255] as RGBA,
  mouthOpen: [90, 35, 35, 255] as RGBA,
  tooth: [255, 247, 232, 255] as RGBA,
  tongue: [196, 98, 98, 255] as RGBA,
  topwear: [40, 106, 99, 255] as RGBA,
  bottomwear: [29, 28, 25, 255] as RGBA
}

function createRaster(): Raster {
  return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }
}

function blendPixel(raster: Raster, x: number, y: number, color: RGBA): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return
  const [r, g, b, a] = color
  if (a <= 0) return
  const index = (y * raster.width + x) * 4
  const sourceAlpha = a / 255
  const destAlpha = raster.data[index + 3]! / 255
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha)
  if (outAlpha === 0) return
  const mix = (src: number, dest: number): number =>
    Math.round((src * sourceAlpha + dest * destAlpha * (1 - sourceAlpha)) / outAlpha)
  raster.data[index] = mix(r, raster.data[index]!)
  raster.data[index + 1] = mix(g, raster.data[index + 1]!)
  raster.data[index + 2] = mix(b, raster.data[index + 2]!)
  raster.data[index + 3] = Math.round(outAlpha * 255)
}

function fillEllipse(raster: Raster, cx: number, cy: number, rx: number, ry: number, color: RGBA): void {
  const left = Math.max(0, Math.floor(cx - rx))
  const right = Math.min(raster.width - 1, Math.ceil(cx + rx))
  const top = Math.max(0, Math.floor(cy - ry))
  const bottom = Math.min(raster.height - 1, Math.ceil(cy + ry))
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) blendPixel(raster, x, y, color)
    }
  }
}

function fillRect(raster: Raster, x: number, y: number, width: number, height: number, color: RGBA): void {
  for (let py = Math.max(0, y); py < Math.min(raster.height, y + height); py++) {
    for (let px = Math.max(0, x); px < Math.min(raster.width, x + width); px++) {
      blendPixel(raster, px, py, color)
    }
  }
}

const EYE_X = { l: 315, r: 485 } as const

const LAYERS: RasterLayer[] = [
  {
    tag: 'FRONT_HAIR',
    draw(r) {
      fillEllipse(r, 400, 205, 235, 118, COLORS.frontHair)
      fillEllipse(r, 205, 390, 66, 190, COLORS.frontHair)
      fillEllipse(r, 595, 390, 66, 190, COLORS.frontHair)
    }
  },
  {
    tag: 'EYELASH',
    side: 'l',
    draw(r) {
      fillEllipse(r, EYE_X.l, 356, 65, 15, COLORS.eyelash)
    }
  },
  {
    tag: 'EYELASH',
    side: 'r',
    draw(r) {
      fillEllipse(r, EYE_X.r, 356, 65, 15, COLORS.eyelash)
    }
  },
  {
    tag: 'EYEBROW',
    side: 'l',
    draw(r) {
      fillEllipse(r, EYE_X.l, 312, 52, 9, COLORS.eyebrow)
    }
  },
  {
    tag: 'EYEBROW',
    side: 'r',
    draw(r) {
      fillEllipse(r, EYE_X.r, 312, 52, 9, COLORS.eyebrow)
    }
  },
  {
    tag: 'IRIDES',
    side: 'l',
    draw(r) {
      fillEllipse(r, EYE_X.l, 392, 23, 26, COLORS.iris)
    }
  },
  {
    tag: 'IRIDES',
    side: 'r',
    draw(r) {
      fillEllipse(r, EYE_X.r, 392, 23, 26, COLORS.iris)
    }
  },
  {
    tag: 'EYEWHITE',
    side: 'l',
    draw(r) {
      fillEllipse(r, EYE_X.l, 392, 55, 30, COLORS.eyewhite)
    }
  },
  {
    tag: 'EYEWHITE',
    side: 'r',
    draw(r) {
      fillEllipse(r, EYE_X.r, 392, 55, 30, COLORS.eyewhite)
    }
  },
  {
    tag: 'FACE_DETAIL',
    draw(r) {
      fillEllipse(r, 272, 490, 42, 20, COLORS.blush)
      fillEllipse(r, 528, 490, 42, 20, COLORS.blush)
      fillEllipse(r, 400, 472, 9, 13, COLORS.skinShadow)
    }
  },
  {
    tag: 'MOUTH',
    draw(r) {
      fillEllipse(r, 400, 558, 46, 12, COLORS.mouth)
    }
  },
  {
    tag: 'TOOTH_T',
    draw(r) {
      fillEllipse(r, 400, 546, 26, 7, COLORS.tooth)
    }
  },
  {
    tag: 'TOOTH_B',
    draw(r) {
      fillEllipse(r, 400, 580, 22, 5, COLORS.tooth)
    }
  },
  {
    tag: 'TONGUE',
    draw(r) {
      fillEllipse(r, 400, 584, 20, 9, COLORS.tongue)
    }
  },
  {
    tag: 'MOUTH_OPEN',
    draw(r) {
      fillEllipse(r, 400, 562, 36, 24, COLORS.mouthOpen)
    }
  },
  {
    tag: 'FACE',
    draw(r) {
      fillEllipse(r, 400, 400, 210, 250, COLORS.skin)
    }
  },
  {
    tag: 'NECK',
    draw(r) {
      fillRect(r, 350, 620, 100, 90, COLORS.skinShadow)
    }
  },
  {
    tag: 'TOPWEAR',
    draw(r) {
      fillEllipse(r, 400, 820, 275, 195, COLORS.topwear)
      fillRect(r, 250, 720, 300, 280, COLORS.topwear)
    }
  },
  {
    tag: 'BOTTOMWEAR',
    draw(r) {
      fillRect(r, 270, 900, 260, 100, COLORS.bottomwear)
    }
  },
  {
    tag: 'BACK_HAIR',
    draw(r) {
      fillEllipse(r, 400, 400, 270, 310, COLORS.backHair)
    }
  }
]

export function layerName(tag: string, side: 'l' | 'r' | undefined, naming: Naming): string {
  const base = naming === 'upper' ? tag : tag.toLowerCase()
  return side ? `${base}-${side}` : base
}

export function FIXTURE_LAYER_NAMES(naming: Naming = 'upper'): string[] {
  return LAYERS.map((layer) => layerName(layer.tag, layer.side, naming))
}

export function buildFixturePsd(options: { naming?: Naming } = {}): Buffer {
  const naming = options.naming ?? 'upper'
  const children: Layer[] = LAYERS.map((layer) => {
    const raster = createRaster()
    layer.draw(raster)
    return {
      name: layerName(layer.tag, layer.side, naming),
      imageData: raster
    }
  })
  return writePsdBuffer(
    {
      width: W,
      height: H,
      children
    },
    { noBackground: true }
  )
}
