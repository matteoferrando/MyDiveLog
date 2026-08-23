import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { DiveLogProvider } from './ui/state';
import { ProvvedituraLingua } from './ui/lingua';
import { inApp, suIOS } from './piattaforma';
import './ui/styles.css';

/*
 * IL GUSCIO SI DICHIARA UNA VOLTA SOLA, SULL'ELEMENTO RADICE.
 *
 * Serve al foglio di stile per la sola cosa che dipende davvero dalla
 * piattaforma e non dalla larghezza della finestra: gli 88 px che l'app
 * desktop lascia liberi per i semafori di macOS. Erano incondizionati, e su un
 * iPhone girato in orizzontale — dove le regole del telefono smettono di valere
 * perché lo schermo supera i 700 px — comparivano come un vuoto inspiegabile
 * sul bordo sinistro.
 *
 * Tutto il resto dell'aspetto continua a dipendere dalla larghezza, che è il
 * criterio giusto: vale anche per un Mac ridotto a metà schermo.
 */
document.documentElement.dataset.guscio = !inApp() ? 'web' : suIOS() ? 'ios' : 'desktop';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root non trovato.');

createRoot(root).render(
  <StrictMode>
    {/*
     * La lingua sta FUORI dall'archivio, e non è un dettaglio d'ordine: la
     * schermata «Apertura dell'archivio…» compare mentre `DiveLogProvider` sta
     * ancora aprendo il database, e deve poter essere già nella lingua giusta.
     */}
    <ProvvedituraLingua>
      <DiveLogProvider>
        <App />
      </DiveLogProvider>
    </ProvvedituraLingua>
  </StrictMode>,
);
