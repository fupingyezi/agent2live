import { mkdirSync, writeFileSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../src/db/client'
import { migrate } from '../src/db/migrate'

const dim = 768
const count = 10_000
const dir = mkdtempSync(join(tmpdir(), 'agent2live-bench-'))
const db = openDatabase(join(dir, 'app.sqlite'))
const migrations = fileURLToPath(new URL('../migrations', import.meta.url))
migrate(db, migrations)

function vector(index: number): Float32Array {
  const out = new Float32Array(dim)
  for (let i = 0; i < dim; i += 1) out[i] = Math.sin(index * 0.001 + i * 0.017) * 0.5
  return out
}

const insert = db.prepare('insert into memory_vectors (space_id, memory_id, embedding) values (?, ?, ?)')
const insertMany = db.transaction((rows: number[]) => {
  for (const i of rows) insert.run('space_bench', `mem_${i}`, vector(i))
})
insertMany(Array.from({ length: count }, (_, i) => i))

const query = db.prepare(
  'select memory_id, distance from memory_vectors where space_id = ? and embedding match ? and k = ?'
)
const q = vector(5000)
for (let i = 0; i < 50; i += 1) query.all('space_bench', q, 10)
const samples: number[] = []
for (let i = 0; i < 200; i += 1) {
  const start = performance.now()
  query.all('space_bench', q, 10)
  samples.push(performance.now() - start)
}
samples.sort((a, b) => a - b)
const p50 = samples[Math.floor(samples.length * 0.5)]!
const p95 = samples[Math.floor(samples.length * 0.95)]!
const result = {
  gate: 'G0-DATA',
  mode: 'real',
  recordedAt: new Date().toISOString(),
  vectorCount: count,
  dimensions: dim,
  p50Ms: Number(p50.toFixed(3)),
  p95Ms: Number(p95.toFixed(3)),
  thresholdP95Ms: 80,
  pass: p95 <= 80,
  dbBytes: statSync(join(dir, 'app.sqlite')).size,
  artifacts: []
}
const outDir = fileURLToPath(new URL('../../../docs/plans/evidence/phase0/G0-DATA/', import.meta.url))
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'data-bench.json'), JSON.stringify(result, null, 2))
db.close()
console.log(JSON.stringify(result, null, 2))
if (!result.pass) process.exit(1)
