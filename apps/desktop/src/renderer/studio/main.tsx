import React from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/harness.css'

function Studio(): React.ReactElement {
  return (
    <main className="harness studio-bg" data-testid="studio-ready">
      <h1>agent2live Studio</h1>
      <p>Phase 0 shell</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Studio />)
