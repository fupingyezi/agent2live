import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'docs/plans'
if (!existsSync(dir)) process.exit(0)
const plans = readdirSync(dir).filter((name) => name.endsWith('.md'))
const leaked = []
for (const name of plans) {
  try {
    execFileSync('git', ['check-ignore', '-q', join(dir, name)], { stdio: 'ignore' })
  } catch {
    leaked.push(join(dir, name))
  }
}
if (leaked.length > 0) {
  console.error(`implementation docs are not ignored: ${leaked.join(', ')}`)
  process.exit(1)
}
console.log(`plans-ignored: ${plans.length} file(s) protected`)
