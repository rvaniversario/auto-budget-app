import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { startPremium } from './premium'
import { startSync } from './sync'
import './index.css'

// Online backup runs in the background when the app is built with a backend.
startSync()
// Premium status follows sign-in and refreshes on open and focus (when switched on).
startPremium()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
