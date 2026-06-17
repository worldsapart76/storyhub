import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import { App } from './App'
import { applyBootstrapFromUrl } from './data/config'

// Pair-by-link: pull a token from the URL hash before the app reads auth state.
applyBootstrapFromUrl()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
