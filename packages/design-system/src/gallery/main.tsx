import React from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/index.css'
import { Gallery } from './Gallery'

const container = document.getElementById('root')

if (!container) throw new Error('Gallery root element is missing')

createRoot(container).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>
)
