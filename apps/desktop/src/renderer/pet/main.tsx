import React from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/harness.css'

function Pet(): React.ReactElement {
  return (
    <main className="harness" data-testid="pet-ready">
      <div style={{ pointerEvents: 'none' }}>agent2live Pet</div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Pet />)
