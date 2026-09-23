import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { applyAppearance } from '@/lib/appearance';
import { applyTheme } from '@/lib/theme';
import '@/styles/globals.css';

// Before the first render, so nothing flashes the wrong palette.
applyTheme();
applyAppearance();

const container = document.getElementById('root');

if (container === null) {
  throw new Error('Root container is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
