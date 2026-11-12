import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { mountModel } from '../shared/live2d-stage'
import '../shared/harness.css'

function Pet(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!canvasRef.current) return
    mountModel(canvasRef.current)
      .then((result) => {
        if (cancelled) return
        ;(window as unknown as { __agent2liveProbe?: unknown }).__agent2liveProbe = result.probe
        setStatus('ready')
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : String(reason))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="harness" data-testid="pet-ready">
      <canvas ref={canvasRef} style={{ width: 360, height: 500, pointerEvents: 'none' }} />
      <div data-testid="model-status" style={{ visibility: 'hidden' }}>
        {status}
      </div>
      {error ? (
        <div role="alert" style={{ position: 'absolute', top: 8, left: 8 }}>
          {error}
        </div>
      ) : null}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Pet />)
