import React from 'react'

export function ProbePanel({ probe }: { probe: unknown }): React.ReactElement {
  return (
    <pre
      data-testid="probe"
      style={{ maxWidth: 560, maxHeight: 220, overflow: 'auto', fontSize: 11, textAlign: 'left' }}
    >
      {JSON.stringify(probe, null, 2)}
    </pre>
  )
}
