import React, { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/600.css'
import '@fontsource/noto-sans-sc/700.css'
import '@agent2live/design-system/styles.css'
import '../shared/harness.css'
import './app.css'
import { mountModel } from '../shared/live2d-stage'
import { ProbePanel } from '../shared/probe-panel'
import type { Live2DProbe } from '@agent2live/live2d-runtime'
import { ApiError } from './api/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import type { EmptyProps } from '@agent2live/design-system'

const ModelHarness: React.FC<EmptyProps> = () => {
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
      <canvas ref={canvasRef} className="studio-harness-canvas" />
      <div data-testid="model-status">{status}</div>
      {error ? <div role="alert">{error}</div> : null}
      {probe ? <ProbePanel probe={probe} /> : null}
    </main>
  )
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false
        return !(error instanceof ApiError) || error.retryable
      }
    },
    mutations: { retry: false }
  }
})

const Root: React.FC<EmptyProps> = () => {
  if (new URLSearchParams(window.location.search).has('model')) {
    return <ModelHarness />
  }
  return (
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
