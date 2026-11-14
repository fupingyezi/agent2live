import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { EmptyProps } from '@agent2live/design-system'
import { StudioAppShell } from './components/StudioAppShell'
import { CharactersPage } from './routes/CharactersPage'
import { NewCharacterPage } from './routes/NewCharacterPage'
import { CharacterCockpitPage } from './routes/CharacterCockpitPage'
import { ArtWorkbenchPage } from './routes/ArtWorkbenchPage'
import { ProvidersPage } from './routes/ProvidersPage'
import { Live2DPlaceholderPage } from './routes/Live2DPlaceholderPage'

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
