import React from 'react'
import type { GenerationCandidateDto } from '@studio/api'
import { CandidateCard } from './CandidateCard'

export interface CandidateGridProps {
  candidates: GenerationCandidateDto[]
  requestedCount: number
  selectedId: string | null
  savingId: string | null
  seconds: number | null
  onSelect(candidateId: string): void
  onSave(candidateId: string): void
  onViewArtVersion(versionId: string): void
  onRetrySlot(): void
}

export const CandidateGrid: React.FC<CandidateGridProps> = ({
  candidates,
  requestedCount,
  selectedId,
  savingId,
  seconds,
  onSelect,
  onSave,
  onViewArtVersion,
  onRetrySlot
}) => {
  const slots = Array.from({ length: Math.max(requestedCount, candidates.length) }, (_, index) => {
    return candidates[index] ?? null
  })
  return (
    <div className="wb3-candidate-grid">
      {slots.map((candidate, index) => (
        <CandidateCard
          key={candidate?.id ?? `failed-${index}`}
          candidate={candidate}
          index={index}
          selected={candidate !== null && candidate.id === selectedId}
          accepted={candidate?.status === 'accepted'}
          saving={candidate !== null && savingId === candidate.id}
          seconds={seconds}
          onSelect={() => {
            if (candidate) onSelect(candidate.id)
          }}
          onSave={() => {
            if (candidate) onSave(candidate.id)
          }}
          onView={() => {
            if (candidate?.acceptedArtVersionId) onViewArtVersion(candidate.acceptedArtVersionId)
          }}
          onRetrySlot={onRetrySlot}
        />
      ))}
    </div>
  )
}
