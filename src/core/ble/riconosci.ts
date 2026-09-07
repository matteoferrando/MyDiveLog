/**
 * Dal nome Bluetooth al modello, per i computer che non hanno un driver di casa.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ ESISTE: «non riconosciuto come computer subacqueo» davanti a un Mares. ◄
 *
 * I due driver scritti in casa riconoscono il loro computer dal nome annunciato
 * (Peregrine, Aladin…). Per tutte le altre marche l'app mostrava il nome,
 * scriveva sotto che non era un computer subacqueo, e chiedeva alla persona di
 * scegliere il modello da un elenco di 105 — anche quando il nome lo diceva
 * già. Un centro immersioni l'ha fatto venti volte con un «Quad Ci».
 *
 * libdivecomputer i nomi li conosce: `dc_descriptor_filter` sa che «Quad Ci» è
 * un Mares, «OSTC» un Heinrichs Weikamp, «FQ001124» un Oceanic/Aqualung — sono
 * gli stessi filtri con cui Subsurface propone il modello. Il guscio Rust li
 * interroga (`riconosci_computer_esterno`) e restituisce i CANDIDATI: i filtri
 * sono per costruttore, quindi per «Quad Ci» tornano tutti i Mares con il
 * Bluetooth. Stringere sul modello è compito di questo file, che conosce il
 * catalogo ed è provabile senza guscio.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * COME SI STRINGE, E PERCHÉ IN QUEST'ORDINE.
 *
 *  1. Un candidato solo: è lui. (Suunto «EON Steel», McLean «McLean Extreme».)
 *  2. Il nome CONTIENE il nome del modello: «Quad Ci» contiene «Quad Ci» ma
 *     anche «Quad»; si tiene il più lungo, perché è il più specifico. Se il più
 *     lungo è uno solo, è lui.
 *  3. Le famiglie che nel nome mettono il NUMERO di modello invece del nome
 *     commerciale: Oceanic/Aqualung annunciano due lettere che sono il numero
 *     in ASCII («FQ» = 0x4651 = i770R), Cressi il numero in esadecimale con un
 *     trattino basso («2_…» = Goa). Le regole sono quelle di `dc_match_oceanic`
 *     e `dc_match_cressi` in `descriptor.c`, riscritte qui sui `numeri` del
 *     catalogo.
 *  4. Altrimenti si sa la famiglia ma non il modello («Mares bluelink pro»,
 *     che è il nome di un adattatore attaccabile a mezza gamma): si propone la
 *     scelta, ristretta ai candidati, invece dell'elenco intero.
 *
 * Una proposta è una proposta: la persona può sempre dire «non è questo». Il
 * costo di una proposta sbagliata è un tentativo che il computer non capisce e
 * un errore leggibile, non una memoria rovinata — vedi `risolvi_profilo` in
 * `ponte_blec.rs`.
 */

import { MODELLI_BLE, type VoceCatalogo } from './catalogo';

/** Un modello come lo restituisce il guscio: marca e modello di libdivecomputer. */
export interface CandidatoRiconosciuto {
  marca: string;
  modello: string;
}

export type Proposta =
  { tipo: 'modello'; voce: VoceCatalogo } | { tipo: 'scelta'; voci: VoceCatalogo[] } | { tipo: 'niente' };

/** Minuscolo e senza niente che non sia lettera o cifra: «Quad Ci» e «QUAD-CI» sono uguali. */
function nudo(testo: string): string {
  return testo.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Le due lettere che Oceanic/Aqualung mettono in testa al nome: il numero di modello in ASCII. */
function prefissoOceanic(numero: number): string | null {
  const alto = (numero >> 8) & 0xff;
  const basso = numero & 0xff;
  const lettera = (c: number) => c >= 0x41 && c <= 0x5a;
  return lettera(alto) && lettera(basso) ? String.fromCharCode(alto, basso) : null;
}

/** Vero se il nome annunciato porta il numero di modello secondo la regola della famiglia. */
function porta_il_numero(nome: string, voce: VoceCatalogo): boolean {
  const numeri = voce.numeri ?? [];
  if (voce.famiglia === 'oceanic_atom2') {
    return numeri.some((n) => {
      const p = prefissoOceanic(n);
      return p !== null && nome.toUpperCase().startsWith(p);
    });
  }
  if (voce.famiglia === 'cressi_goa') {
    return numeri.some((n) => nome.toLowerCase().startsWith(`${n.toString(16)}_`));
  }
  return false;
}

/**
 * Cosa proporre per un dispositivo con questo nome, dati i candidati del guscio.
 *
 * `catalogo` è un parametro per le prove; nell'app è il catalogo vero.
 */
export function proponi(
  nome: string,
  candidati: readonly CandidatoRiconosciuto[],
  catalogo: readonly VoceCatalogo[] = MODELLI_BLE,
): Proposta {
  const pulito = nome.trim();
  if (pulito === '' || candidati.length === 0) return { tipo: 'niente' };

  const voci = candidati
    .map((c) => catalogo.find((v) => v.marca === c.marca && v.modello === c.modello))
    .filter((v): v is VoceCatalogo => v !== undefined);
  if (voci.length === 0) return { tipo: 'niente' };
  if (voci.length === 1) return { tipo: 'modello', voce: voci[0] };

  const nomeNudo = nudo(pulito);
  const perNome = voci.filter((v) => nudo(v.modello) !== '' && nomeNudo.includes(nudo(v.modello)));
  if (perNome.length > 0) {
    const lunghezza = Math.max(...perNome.map((v) => nudo(v.modello).length));
    const migliori = perNome.filter((v) => nudo(v.modello).length === lunghezza);
    if (migliori.length === 1) return { tipo: 'modello', voce: migliori[0] };
  }

  const perNumero = voci.filter((v) => porta_il_numero(pulito, v));
  if (perNumero.length === 1) return { tipo: 'modello', voce: perNumero[0] };

  return { tipo: 'scelta', voci };
}
