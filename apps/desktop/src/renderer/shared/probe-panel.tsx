import React from 'react'
import type { Live2DProbe } from '@agent2live/live2d-runtime'

export interface ProbePanelProps {
  probe: Live2DProbe
}

export const ProbePanel: React.FC<ProbePanelProps> = ({ probe }) => {
  return (
    <pre
      data-testid="probe"
      style={{ maxWidth: 560, maxHeight: 220, overflow: 'auto', fontSize: 11, textAlign: 'left' }}
    >
      {JSON.stringify(probe, null, 2)}
    </pre>
  )
}
