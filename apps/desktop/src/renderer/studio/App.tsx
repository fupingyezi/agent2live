import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { EmptyProps } from '@agent2live/design-system'
import { StudioAppShell } from './components/StudioAppShell'
import { CharactersPage } from './routes/CharactersPage'
import { NewCharacterPage } from './routes/NewCharacterPage'
import { CharacterCockpitPage } from './routes/CharacterCockpitPage'
import { ArtWorkbenchPage } from './routes/ArtWorkbenchPage'

export const App: React.FC<EmptyProps> = () => {
  return (
    <Routes>
      <Route element={<StudioAppShell />}>
        <Route index element={<CharactersPage />} />
        <Route path="characters/new" element={<NewCharacterPage />} />
        <Route path="characters/:characterId" element={<CharacterCockpitPage />} />
        <Route path="characters/:characterId/art" element={<ArtWorkbenchPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
