/**
 * Sapere in che pagina si è, e poter andare in un'altra.
 *
 * PERCHÉ SERVE. Le pagine vuote dicevano «importa un file per iniziare» e poi
 * lasciavano lì: chi legge deve trovarsi da sé la scheda giusta, e su un
 * telefono quella scheda è dietro il menu. Un vicolo cieco cortese resta un
 * vicolo cieco.
 *
 * Un contesto minuscolo invece di passare una funzione attraverso quattro
 * livelli di proprietà: le pagine che devono mandare altrove sono poche e
 * sparse, e infilare `onVaiA` in ogni firma le sporcherebbe tutte per una cosa
 * che riguarda il guscio.
 */

import { createContext, useContext, type ReactNode } from 'react';

export type Vista =
  | 'logbook'
  | 'compare'
  | 'stats'
  | 'coach'
  | 'planner'
  | 'gear'
  | 'import'
  /* «Il tuo profilo»: nata il 15 settembre 2026 staccando da Impostazioni le
     due carte che parlano di CHI si immerge invece che di come funziona il
     programma. Vedi `pages/ProfiloPage.tsx`. */
  | 'profilo'
  | 'sync';

/*
 * ► LE TABELLE DELLE DESTINAZIONI STANNO QUI, E NON PIÙ IN `App.tsx`. ◄
 *
 * Non è un riordino: è quello che rende verificabile la navigazione. Dentro
 * `App.tsx` nessuna prova poteva leggerle senza tirarsi dietro il guscio
 * intero — le pagine pigre, l'archivio, il contesto della lingua — e infatti
 * non c'era nessuna prova. Il risultato è che «una pagina esiste ma dal
 * telefono non ci si arriva» era un difetto che solo un occhio poteva vedere, e
 * solo se guardava la scheda giusta.
 *
 * Questo file non importa niente: costa un `import` e in cambio
 * `tests/navigazioneDelTelefono.test.ts` può pretendere che ogni scheda sia
 * raggiungibile una volta e una sola.
 */
/*
 * Le etichette restano ITALIANE nella tabella, e si traducono al disegno.
 *
 * È la regola di tutta l'applicazione (vedi `lingua.tsx`): la frase italiana è
 * la chiave. Tradurle qui, una volta, vorrebbe dire tenere la tabella dentro il
 * componente per poter usare `t()` — e ricostruirla a ogni render per otto
 * stringhe costanti.
 */
export const TABS: { id: Vista; label: string }[] = [
  { id: 'logbook', label: 'Logbook' },
  { id: 'compare', label: 'Confronta' },
  { id: 'stats', label: 'Statistiche' },
  { id: 'coach', label: 'Suggerimenti' },
  { id: 'planner', label: 'Gas' },
  { id: 'gear', label: 'Attrezzatura' },
  { id: 'import', label: 'Importa' },
  { id: 'profilo', label: 'Il tuo profilo' },
  { id: 'sync', label: 'Impostazioni' },
];

/*
 * ► LA BARRA IN BASSO: QUATTRO DESTINAZIONI E UN COMANDO, SEMPRE A SCHERMO. ◄
 *
 * Il menu a comparsa che c'era prima risolveva il trascinamento laterale della
 * striscia, e ne ha lasciato aperto un altro: **nove voci tutte uguali, senza
 * nessuna gerarchia, a due tocchi di distanza da qualunque cosa.** Chi ha
 * guardato l'app da fuori l'ha detto in una riga — «non si capisce cos'è
 * importante». Aveva ragione: un elenco in cui «Logbook» e «Riconoscimenti»
 * hanno lo stesso peso non è una navigazione, è un indice.
 *
 * Qui invece si decide. Le quattro destinazioni che si aprono ogni giorno
 * stanno sempre a schermo, sotto il pollice, a UN tocco; il resto vive dietro
 * «Altro», che è un tocco in più per roba che si apre una volta al mese.
 *
 * ► PERCHÉ PROPRIO QUESTE QUATTRO. ◄ Non a sentimento: sono le uniche che si
 * aprono senza un motivo particolare. Logbook è la pagina di casa; Statistiche
 * è quello che si guarda dopo un'uscita; Gas è l'unica che si consulta PRIMA di
 * immergersi, cioè in barca, con i guanti, dove i due tocchi costano davvero.
 * Confronta e Suggerimenti guardano gli stessi dati con un'altra lente:
 * bellissime, e non quotidiane.
 *
 * ► IMPORTA STA IN MEZZO E SPORGE, e non è decorazione. ◄ È l'unica voce che
 * non porta a guardare qualcosa: porta a FARE la cosa senza la quale tutte le
 * altre pagine sono vuote. È anche il primo gesto di chiunque installi l'app, e
 * il gesto che si ripete dopo ogni uscita. Il centro della barra è il punto più
 * facile da colpire con il pollice di entrambe le mani: gli altri quattro
 * bersagli sono comodi per una mano sola.
 */
export const BARRA: { id: Vista; label: string }[] = [
  { id: 'logbook', label: 'Logbook' },
  { id: 'stats', label: 'Statistiche' },
  { id: 'import', label: 'Importa' },
  { id: 'planner', label: 'Gas' },
];

/*
 * ► «ALTRO» È DIVISO, E LA DIVISIONE È QUELLA CHIESTA: DATI DA UNA PARTE,
 *   FUNZIONI DALL'ALTRA. ◄
 *
 * Nel menu vecchio «Attrezzatura» e «Impostazioni» erano due righe consecutive
 * indistinguibili, e sono due cose che non si somigliano per niente: una è roba
 * tua che hai registrato, l'altra è il comportamento del programma. Le
 * intestazioni costano tre righe di schermo e in cambio dicono, prima ancora di
 * leggere le voci, in quale metà del mondo si sta guardando.
 *
 * Le intestazioni restano ITALIANE nella tabella e si traducono al disegno,
 * come le etichette: stessa regola, stesso motivo (vedi `TABS`).
 */
export const GRUPPI_ALTRO: { titolo: string; voci: Vista[] }[] = [
  { titolo: 'Le tue immersioni', voci: ['compare', 'coach'] },
  { titolo: 'Tu', voci: ['profilo', 'gear'] },
  { titolo: 'L’applicazione', voci: ['sync'] },
];

const CONTESTO = createContext<(vista: Vista) => void>(() => {});

export function ProvvedituraNavigazione({
  vaiA,
  children,
}: {
  vaiA: (vista: Vista) => void;
  children: ReactNode;
}) {
  return <CONTESTO.Provider value={vaiA}>{children}</CONTESTO.Provider>;
}

/** Manda a un'altra pagina. Fuori dal guscio non fa niente, e va bene così. */
export function useVaiA(): (vista: Vista) => void {
  return useContext(CONTESTO);
}
