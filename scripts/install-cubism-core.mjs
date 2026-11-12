import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const source = process.env.CUBISM_CORE_SOURCE
if (!source || !existsSync(source)) {
  console.error('Cubism Core not found. Set CUBISM_CORE_SOURCE to a user-provided live2dcubismcore.min.js.')
  process.exit(1)
}
const targetDir = join('apps', 'desktop', 'src', 'renderer', 'public', 'live2d')
mkdirSync(targetDir, { recursive: true })
const target = join(targetDir, 'live2dcubismcore.min.js')
copyFileSync(source, target)
const bytes = readFileSync(target)
const sha = createHash('sha256').update(bytes).digest('hex')
if (bytes.length < 100_000 || !bytes.toString('utf8').includes('Live2DCubismCore')) {
  console.error(`source does not look like Cubism Core: ${source} (${bytes.length} bytes)`)
  process.exit(1)
}
console.log(JSON.stringify({ source, target, bytes: statSync(target).size, sha256: sha }, null, 2))
