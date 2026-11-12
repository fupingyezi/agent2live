import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  FIXTURE_HEIGHT,
  FIXTURE_LAYER_NAMES,
  FIXTURE_WIDTH,
  buildFixturePsd,
  type Naming
} from './lib/fixture'

const outIndex = process.argv.indexOf('--out')
const out = resolve(outIndex >= 0 ? process.argv[outIndex + 1]! : 'spikes/psd2live/work/fixture.psd')
const naming: Naming = process.env.FIXTURE_NAMING === 'lower' ? 'lower' : 'upper'
mkdirSync(dirname(out), { recursive: true })
const bytes = buildFixturePsd({ naming })
writeFileSync(out, bytes)
console.log(
  JSON.stringify(
    {
      out,
      naming,
      width: FIXTURE_WIDTH,
      height: FIXTURE_HEIGHT,
      layers: FIXTURE_LAYER_NAMES(naming),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    },
    null,
    2
  )
)
