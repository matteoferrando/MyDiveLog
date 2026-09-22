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
 * E DUE REGOLE AGGIUNTE IL 22 SETTEMBRE 2026, aggiornando libdivecomputer —
 * tutte e due per i Mares, dove sbagliare modello non è un'etichetta storta ma
 * uno scarico che non parte (vedi `MARES_BLE_NATIVI`):
 *
 *  0. Prima di tutto, fra i Mares, **il nome dice da che parte stare**: chi
 *     annuncia «Mares bluelink pro» è un Mares vecchio dietro l'adattatore,
 *     chi annuncia un nome suo (Quad2, Puck4, Sirius…) è uno dei nuovi col
 *     Bluetooth dentro. Le due metà non si mescolano mai.
 *  2b. Il nome annunciato può essere il nome del modello **troncato**: «Puck
 *     Pro U» è l'inizio di «Puck Pro Ultra», e la regola 2 non lo vede perché
 *     cerca il modello DENTRO il nome, non il nome dentro il modello.
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
  if (voce.famiglia === 'halcyon_symbios') {
    /*
     * `dc_match_halcyon` in `descriptor.c`: o il nome comincia con «H» e il
     * numero di modello su due cifre («H01…» è l'HUD, «H07…» il palmare),
     * oppure è fatto di sole cifre, almeno dieci, e il numero sta al quinto e
     * sesto posto. Riscritta qui come le due sopra.
     */
    return numeri.some((n) => {
      const due = String(n).padStart(2, '0');
      if (nome.toUpperCase().startsWith(`H${due}`)) return true;
      return /^\d{10,}$/.test(nome) && nome.slice(4, 6) === due;
    });
  }
  return false;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ► I MARES CHE PARLANO BLE DA SOLI, E QUELLI CHE CI ARRIVANO CON L'ADATTATORE. ◄
 *
 * `mares_iconhd_device_open` decide COME leggere i pacchetti Bluetooth dal
 * numero di modello del descrittore scelto — non da quello che dirà il
 * computer, che a quel punto non ha ancora parlato:
 *
 *     device->ble = ISSIRIUS(model) ? VARIABLE : FIXED;
 *
 * `ISSIRIUS` sono i Mares nuovi, col Bluetooth dentro: Puck Air 2 (0x2D),
 * Sirius (0x2F), Quad Ci (0x31), Quad 2 (0x32), Sirius L (0x33) e la famiglia
 * del Puck 4 (0x35: Puck 4, Puck Lite, Puck Pro EZ, Puck Pro Ultra). Il Genius
 * (0x1C) ha il Bluetooth suo ma il pacchetto fisso. Gli altri Mares del
 * catalogo — Puck Pro, Quad, Quad Air, Smart… — fra i nomi che
 * `dc_filter_mares` conosce non ne hanno uno loro: al Bluetooth ci arrivano
 * dall'adattatore BlueLink Pro, e parlano a pacchetto fisso.
 *
 * Quindi **proporre un Puck Pro a chi ha un Puck Pro Ultra non è un'etichetta
 * sbagliata: è uno scarico che non parte**, perché il backend aspetterebbe
 * pacchetti di una forma che quel computer non manda. È esattamente quello che
 * la regola del «nome più lungo contenuto» avrebbe fatto con «Puck Pro U», il
 * nome che `dc_filter_mares` elenca per l'Ultra.
 *
 * I numeri sono quelli di `mares_iconhd.c` e `descriptor.c` del ramo principale
 * (22 settembre 2026); una prova li confronta con l'elenco del ponte Rust,
 * `MARES_PACCHETTO_INTERO`, che deve dire la stessa cosa per i nomi.
 */
export const MARES_BLE_NATIVI: ReadonlySet<number> = new Set([0x1c, 0x2d, 0x2f, 0x31, 0x32, 0x33, 0x35]);

/**
 * Fra candidati tutti Mares, tiene la metà giusta.
 *
 * Il nome del BlueLink vuol dire «uno di quelli dell'adattatore». Un nome che
 * combacia — dentro o troncato — con uno dei nativi vuol dire «uno dei
 * nativi», e gli altri escono dalla proposta. Un nome che non dice né l'una né
 * l'altra cosa lascia tutto com'era: restringere senza un motivo sarebbe
 * indovinare. Per ogni altra famiglia, o se restringendo non restasse nessuno,
 * si lascia tutto com'era.
 */
function restringiMares(nomeNudo: string, voci: VoceCatalogo[]): VoceCatalogo[] {
  if (voci.length === 0 || voci.some((v) => v.famiglia !== 'mares_iconhd')) return voci;
  const nativo = (v: VoceCatalogo) => (v.numeri ?? []).some((n) => MARES_BLE_NATIVI.has(n));
  if (nomeNudo.startsWith('maresbluelink')) {
    const adattatore = voci.filter((v) => !nativo(v));
    return adattatore.length > 0 ? adattatore : voci;
  }
  const nativi = voci.filter(nativo);
  const combacia = (v: VoceCatalogo) => {
    const m = nudo(v.modello);
    return m !== '' && (nomeNudo.includes(m) || (nomeNudo.length >= 4 && m.startsWith(nomeNudo)));
  };
  return nativi.some(combacia) ? nativi : voci;
}

/**
 * I nomi che Subsurface conosce e i filtri di libdivecomputer no.
 *
 * `btdiscovery.cpp` di Subsurface riconosce due forme vecchie dei Cressi —
 * «CARESIO_…» e «GOA_…» — che `dc_filter_cressi` non guarda più: il filtro
 * della libreria vuole il numero di modello in esadecimale («2_…»). Chi ha un
 * firmware che annuncia la forma vecchia riceverebbe «nessun candidato» e
 * l'elenco intero; qui riceve il suo modello. Si usano SOLO quando il guscio
 * non ha trovato niente: i filtri della libreria restano la prima parola.
 */
const NOMI_DI_SUBSURFACE: readonly { prefisso: string; marca: string; modello: string }[] = [
  { prefisso: 'CARESIO_', marca: 'Cressi', modello: 'Cartesio' },
  { prefisso: 'GOA_', marca: 'Cressi', modello: 'Goa' },
];

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
  if (pulito === '') return { tipo: 'niente' };
  if (candidati.length === 0) {
    const alias = NOMI_DI_SUBSURFACE.find((a) => pulito.toUpperCase().startsWith(a.prefisso));
    const voce = alias && catalogo.find((v) => v.marca === alias.marca && v.modello === alias.modello);
    return voce ? { tipo: 'modello', voce } : { tipo: 'niente' };
  }

  const tutte = candidati
    .map((c) => catalogo.find((v) => v.marca === c.marca && v.modello === c.modello))
    .filter((v): v is VoceCatalogo => v !== undefined);
  if (tutte.length === 0) return { tipo: 'niente' };
  if (tutte.length === 1) return { tipo: 'modello', voce: tutte[0]! };

  const nomeNudo = nudo(pulito);
  // Regola 0: fra i Mares, la metà giusta. Vedi `MARES_BLE_NATIVI`.
  const voci = restringiMares(nomeNudo, tutte);
  if (voci.length === 1) return { tipo: 'modello', voce: voci[0]! };

  const perNome = voci.filter((v) => nudo(v.modello) !== '' && nomeNudo.includes(nudo(v.modello)));
  if (perNome.length > 0) {
    const lunghezza = Math.max(...perNome.map((v) => nudo(v.modello).length));
    const migliori = perNome.filter((v) => nudo(v.modello).length === lunghezza);
    if (migliori.length === 1) return { tipo: 'modello', voce: migliori[0]! };
  }

  /*
   * Regola 2b: il nome è il modello troncato. Almeno quattro caratteri, perché
   * un nome di due lettere è l'inizio di troppe cose per voler dire qualcosa.
   * Più d'uno che cominciano così è comunque una notizia — «Puck» è l'inizio
   * di cinque Puck, tutti nuovi — e si propone la scelta fra loro soltanto.
   */
  if (perNome.length === 0 && nomeNudo.length >= 4) {
    const troncati = voci.filter((v) => {
      const m = nudo(v.modello);
      return m.length > nomeNudo.length && m.startsWith(nomeNudo);
    });
    if (troncati.length === 1) return { tipo: 'modello', voce: troncati[0]! };
    if (troncati.length > 1) return { tipo: 'scelta', voci: troncati };
  }

  const perNumero = voci.filter((v) => porta_il_numero(pulito, v));
  if (perNumero.length === 1) return { tipo: 'modello', voce: perNumero[0]! };

  return { tipo: 'scelta', voci };
}
