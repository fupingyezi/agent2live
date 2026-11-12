import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Live2DProbe } from '@agent2live/live2d-runtime'
import type { EmptyProps } from '../shared/model-types'
import { mountModel } from '../shared/live2d-stage'
import { ProbePanel } from '../shared/probe-panel'
import '../shared/harness.css'

export const Studio: React.FC<EmptyProps> = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('loading')
  const [probe, setProbe] = useState<Live2DProbe | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!canvasRef.current) return
    mountModel(canvasRef.current)
      .then((result) => {
        if (cancelled) return
        setProbe(result.probe)
        setStatus('ready')
        window.__agent2liveProbe = result.probe
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
    <main className="harness studio-bg" data-testid="studio-ready">
      <h1>agent2live Studio</h1>
      <canvas ref={canvasRef} style={{ width: 420, height: 420 }} />
      <div data-testid="model-status">{status}</div>
      {error ? <div role="alert">{error}</div> : null}
      {probe ? <ProbePanel probe={probe} /> : null}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Studio />)
