import { expect, it } from 'vitest'
import { AuditService } from '../src/services/audit'
import { createTestDatabase } from './helpers/app'

it('writes audit rows without prompt text and within the caller transaction', () => {
  const { db } = createTestDatabase()
  const audit = new AuditService(db)
  db.transaction(() => {
    audit.append({
      actor: { kind: 'local-user' },
      action: 'prompt.version.created',
      targetType: 'prompt_version',
      targetId: 'pv_1',
      outcome: 'success',
      requestId: 'req_1',
      traceId: 'trc_1',
      metadata: { versionNumber: 1, contentHash: 'a'.repeat(64) }
    })
  })()
  const row = db.prepare('select * from audit_events').get() as {
    metadata_json: string
    action: string
  }
  expect(row.action).toBe('prompt.version.created')
  expect(row.metadata_json).not.toContain('银白')
  expect(JSON.parse(row.metadata_json).contentHash).toHaveLength(64)
})

it('rejects metadata that could carry prompt text or secrets', () => {
  const { db } = createTestDatabase()
  const audit = new AuditService(db)
  for (const metadata of [{ promptText: 'hidden' }, { apiKey: 'hidden' }]) {
    expect(() =>
      audit.append({
        actor: { kind: 'system', component: 'test' },
        action: 'asset.created',
        targetType: 'asset',
        targetId: 'ast_1',
        outcome: 'success',
        requestId: 'req_2',
        traceId: 'trc_2',
        metadata
      })
    ).toThrow(/AUDIT_METADATA_FORBIDDEN/)
  }
  const count = db.prepare('select count(*) as n from audit_events').get() as { n: number }
  expect(count.n).toBe(0)
})
