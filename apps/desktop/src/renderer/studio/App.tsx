import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { EmptyProps } from '@agent2live/design-system'
import { StudioAppShell } from '@studio/components'
import {
  ArtWorkbenchPage,
  CharacterCockpitPage,
  CharactersPage,
  Live2DPlaceholderPage,
  NewCharacterPage,
  ProvidersPage
} from '@studio/routes'

export const App: React.FC<EmptyProps> = () => {
  return (
    <Routes>
      <Route element={<StudioAppShell />}>
        <Route index element={<CharactersPage />} />
        <Route path="characters/new" element={<NewCharacterPage />} />
        <Route path="characters/:characterId" element={<CharacterCockpitPage />} />
        <Route path="characters/:characterId/art" element={<ArtWorkbenchPage />} />
        <Route path="settings/providers" element={<ProvidersPage />} />
        <Route path="characters/:characterId/live2d" element={<Live2DPlaceholderPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
