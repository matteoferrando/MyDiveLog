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

export type Vista = 'logbook' | 'compare' | 'stats' | 'coach' | 'planner' | 'gear' | 'import' | 'sync';

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
