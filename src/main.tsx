import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { DiveLogProvider } from './ui/state';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root non trovato.');

createRoot(root).render(
  <StrictMode>
    <DiveLogProvider>
      <App />
    </DiveLogProvider>
  </StrictMode>,
);
