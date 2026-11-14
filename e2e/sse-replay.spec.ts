import { test, expect } from '@playwright/test'
import { launchStudio } from './helpers/app'
import { ApiClient } from './helpers/api'
import { openSse, type SseConnection } from './helpers/sse'
import { writeEvidenceJson } from './helpers/evidence'

test('replays events by the after cursor rather than trusting Last-Event-ID alone', async () => {
  test.setTimeout(90_000)
  const studio = await launchStudio('agent2live-sse-replay-')
  let first: SseConnection | null = null
  let second: SseConnection | null = null
  try {
    const api = new ApiClient(studio.endpoint)

    first = await openSse(studio.endpoint, { after: 0 })
    const characterA = await api.createCharacter('SSE 重放 A')
    const eventA = await first.waitFor(
      (event) =>
        event.type === 'character.created' &&
        event.scope.kind === 'character' &&
        event.scope.id === characterA.id,
      10_000,
      `character.created for ${characterA.id}`
    )
    expect(eventA.seq).toBeGreaterThan(0)
    expect(eventA.id).toBe(eventA.seq)
    expect(eventA.schemaVersion).toBe('event/1')
    first.close()
    first = null

    const after = eventA.seq - 1
    const headerValue = String(eventA.seq)
    second = await openSse(studio.endpoint, {
      after,
      lastEventId: headerValue
    })
    const replayed = await second.waitFor(
      (event) => event.seq === eventA.seq,
      10_000,
      `replayed event ${eventA.seq}`
    )
    expect(replayed.id).toBe(eventA.id)
    expect(replayed.type).toBe(eventA.type)
    expect(replayed.scope).toEqual(eventA.scope)
    expect(replayed.payload).toEqual(eventA.payload)

    const characterB = await api.createCharacter('SSE 重放 B')
    const eventB = await second.waitFor(
      (event) =>
        event.type === 'character.created' &&
        event.scope.kind === 'character' &&
        event.scope.id === characterB.id,
      10_000,
      `character.created for ${characterB.id}`
    )
    expect(eventB.seq).toBeGreaterThan(eventA.seq)

    const observedSeqs = second.events.map((event) => event.seq)
    expect(new Set(observedSeqs).size).toBe(observedSeqs.length)
    expect([...observedSeqs].sort((left, right) => left - right)).toEqual(observedSeqs)
    expect(observedSeqs[0]).toBe(eventA.seq)

    writeEvidenceJson('sse-replay.json', {
      schemaVersion: 'sse-replay/1',
      status: 'pass',
      generatedAt: new Date().toISOString(),
      characterAId: characterA.id,
      characterBId: characterB.id,
      initialSeq: eventA.seq,
      after,
      lastEventIdHeader: headerValue,
      replayedSeq: replayed.seq,
      secondSeq: eventB.seq,
      observedSeqs,
      checks: {
        replayedByQueryCursor: replayed.seq === eventA.seq,
        replayedPayloadMatches: JSON.stringify(replayed.payload) === JSON.stringify(eventA.payload),
        secondEventIsNewer: eventB.seq > replayed.seq,
        seqStrictlyIncreasing:
          observedSeqs.length > 1 &&
          observedSeqs.every((seq, index) => index === 0 || seq > observedSeqs[index - 1]!)
      }
    })
  } finally {
    second?.close()
    first?.close()
    await studio.close()
  }
})
