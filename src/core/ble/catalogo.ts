/**
 * Scegliere marca e modello, quando il computer non si riconosce da solo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * IL PROBLEMA, IN UN NUMERO SOLO.
 *
 * libdivecomputer descrive 356 modelli. Di questi, **110 parlano BLE**, cioè
 * sono gli unici raggiungibili da un telefono: su iPhone la porta seriale non
 * esiste, l'USB non esiste, e il Bluetooth classico è riservato ai profili di
 * sistema. Già questo taglia due terzi dell'elenco, e nessuno ci perde niente —
 * anzi: mostrare un modello che il telefono non potrà mai contattare vuol dire
 * far scegliere l'utente e dargli la colpa dopo.
 *
 * Restano 110 modelli e 20 marche. Un elenco di 110 voci su uno schermo da
 * telefono è un elenco che si scorre, non che si legge.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► L'ORDINE OVVIO È ESATTAMENTE QUELLO SBAGLIATO. ◄
 *
 * Ordinando per numero di modelli — che è l'ordine in cui la libreria li
 * elenca, e quello che verrebbe da usare — l'elenco esce così:
 *
 *      Ratio               25 modelli
 *      Mares               13
 *      Shearwater          11
 *      Scubapro            11
 *      Heinrichs Weikamp   10
 *      Aqualung             9
 *      Cressi               7
 *      Oceanic              5
 *      Suunto               4
 *
 * Adesso l'altra colonna: quanti subacquei possiedono davvero quella marca.
 * Dall'indagine del Business of Diving Institute (subacquei ricreativi, uso
 * attuale): **Shearwater 51.5%, Suunto 20.3%, Scubapro 5.7%, Garmin 4.4%,
 * Oceanic 3.5%, Mares 3.5%, Cressi 2.6%, Aqualung 2.2%, Ratio 1.3%.** Fra i
 * subacquei tecnici Shearwater arriva al **79.1%** e Ratio all'1.8%.
 *
 * Cioè: **Ratio ha venticinque modelli e un subacqueo su settanta; Shearwater
 * ne ha undici e uno su due. Suunto è penultima per numero di modelli ed è la
 * seconda marca più diffusa al mondo.** Un elenco ordinato per numero di
 * modelli mette per primo quello che quasi nessuno ha e in fondo quello che ha
 * un utente su cinque.
 *
 * Da qui l'ordinamento di questo file: **per diffusione, non per catalogo.**
 *
 * IL LIMITE DELL'INDAGINE, dichiarato perché conta. È un campione di subacquei
 * raggiunti online, quindi sovrarappresenta chi è appassionato e sottostima le
 * marche da primo acquisto — Cressi, Mares e Aqualung vendono molti più pezzi
 * di quanto quella percentuale suggerisca. Ma il nostro utente non è «un
 * subacqueo qualunque»: è uno che installa un logbook capace di leggere due
 * computer diversi. Quella popolazione somiglia molto più al campione
 * dell'indagine che alle vendite globali, ed è per questo che l'indagine è il
 * riferimento giusto qui e non lo sarebbe altrove.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * E SOPRATTUTTO: QUESTA SCHERMATA QUASI NESSUNO DOVREBBE VEDERLA.
 *
 * I due driver scritti in casa riconoscono Shearwater e Scubapro/Uwatec dal
 * nome con cui si annunciano, senza chiedere niente a nessuno. Sono, da soli,
 * il 57% dei subacquei ricreativi e l'80% di quelli tecnici. Il selettore
 * serve per il resto — ed è il motivo per cui vale la pena farlo bene ma non
 * metterlo davanti a tutti.
 */

import { MODELLI_BLE, type ModelloComputer } from './catalogoGenerato';

/**
 * Una voce scegliibile: quelle del catalogo, più quelle che un driver non ce
 * l'hanno affatto.
 *
 * `famiglia` è opzionale perché la sua assenza SIGNIFICA qualcosa — «nessun
 * driver di libdivecomputer legge questo apparecchio» — e non è un dato
 * mancante da riempire più avanti.
 */
export interface VoceCatalogo {
  marca: string;
  modello: string;
  famiglia?: string;
  numeri?: readonly number[];
}

/**
 * Quanto è diffusa una marca fra i subacquei, in percentuale.
 *
 * Fonte: Business of Diving Institute, indagine sull'uso dei computer
 * subacquei — colonna «subacquei ricreativi, uso attuale». Le marche che
 * l'indagine non nomina non compaiono qui e finiscono in fondo, il che è
 * corretto: se un'indagine sui computer subacquei non le ha viste, sono rare.
 *
 * I numeri servono a ORDINARE, non a essere mostrati: nessuna schermata dice
 * «Shearwater, 51.5%». Sarebbero un dato di mercato spacciato per consiglio.
 */
const DIFFUSIONE: Record<string, number> = {
  Shearwater: 51.5,
  Suunto: 20.3,
  Scubapro: 5.7,
  Garmin: 4.4,
  Oceanic: 3.5,
  Mares: 3.5,
  Cressi: 2.6,
  Aqualung: 2.2,
  Ratio: 1.3,
  Divesoft: 1.0,
  Sherwood: 1.0,
};

/**
 * Le marche riconosciute senza chiedere niente, dai driver scritti in casa.
 *
 * Non compaiono nel selettore come «da scegliere»: se hai uno di questi in
 * mano, l'applicazione lo ha già capito. Elencarle insieme alle altre farebbe
 * sembrare necessaria una scelta che non lo è.
 */
export const RICONOSCIUTE_DA_SOLE = ['Shearwater', 'Scubapro', 'Uwatec'] as const;

/**
 * I computer che NON stanno nel catalogo di libdivecomputer, e che qualcuno
 * cercherà lo stesso.
 *
 * ► IL DIFETTO CHE CHIUDE: la risposta su Garmin era irraggiungibile. ◄
 *
 * `SENZA_SCARICO_DIRETTO` c'era già ed `esitoPer` sapeva rispondere
 * «mai-via-radio» — ma nel catalogo generato la parola «Garmin» non compare
 * nemmeno una volta, perché libdivecomputer un driver per i Descent non ce l'ha.
 * Quindi quel ramo, e la frase che l'interfaccia gli aveva preparato accanto,
 * non li vedeva nessuno: chi scriveva «garmin» nella ricerca riceveva «Nessun
 * modello con questo nome», cioè la risposta più inutile possibile su una delle
 * marche più diffuse al mondo.
 *
 * Queste voci esistono per essere TROVATE dalla ricerca e ricevere la risposta
 * vera. Non hanno famiglia perché non c'è nessun driver dietro, ed è esattamente
 * quello che vogliamo dire.
 *
 * L'elenco è corto di proposito — i modelli in commercio — perché non è un
 * catalogo: è un cartello che dice «di qua non si passa, si passa di là».
 */
export const MODELLI_SENZA_BLE: readonly VoceCatalogo[] = [
  { marca: 'Garmin', modello: 'Descent Mk1' },
  { marca: 'Garmin', modello: 'Descent Mk2' },
  { marca: 'Garmin', modello: 'Descent Mk2i' },
  { marca: 'Garmin', modello: 'Descent Mk2S' },
  { marca: 'Garmin', modello: 'Descent Mk3' },
  { marca: 'Garmin', modello: 'Descent Mk3i' },
  { marca: 'Garmin', modello: 'Descent G1' },
  { marca: 'Garmin', modello: 'Descent G2' },
];

/**
 * ► GARMIN NON C'È, ED È LA DOMANDA CHE ARRIVERÀ PER PRIMA. ◄
 *
 * Nell'indagine Garmin è il 4.4% — quarta marca — e in questo catalogo non
 * compare nemmeno una volta. Non è una dimenticanza: i Descent non espongono i
 * dati delle immersioni via BLE a un'applicazione qualunque, li mandano ai
 * server di Garmin attraverso Garmin Connect. libdivecomputer non ha un driver
 * perché non c'è niente da guidare.
 *
 * La strada, per chi ha un Descent, è l'esportazione da Garmin Connect e poi
 * l'importazione di quel file. Va detto lì dove l'utente cerca Garmin e non la
 * trova, altrimenti l'assenza sembra un guasto.
 */
export const SENZA_SCARICO_DIRETTO = ['Garmin'] as const;

export interface MarcaCatalogo {
  marca: string;
  modelli: readonly ModelloComputer[];
  /** Vero se uno dei driver scritti in casa la riconosce da solo. */
  automatica: boolean;
}

/**
 * Le marche, dalla più diffusa alla più rara.
 *
 * A parità di diffusione — cioè fra le marche che l'indagine non nomina —
 * l'ordine è alfabetico e non per numero di modelli: fra due marche che nessuno
 * ha, quella con più modelli non è più probabile, è solo più prolissa.
 */
export function marchePerDiffusione(): MarcaCatalogo[] {
  const perMarca = new Map<string, ModelloComputer[]>();
  for (const m of MODELLI_BLE) {
    const elenco = perMarca.get(m.marca);
    if (elenco) elenco.push(m);
    else perMarca.set(m.marca, [m]);
  }
  return [...perMarca.entries()]
    .map(([marca, modelli]) => ({
      marca,
      modelli,
      automatica: (RICONOSCIUTE_DA_SOLE as readonly string[]).includes(marca),
    }))
    .sort((a, b) => {
      const da = DIFFUSIONE[a.marca] ?? 0;
      const db = DIFFUSIONE[b.marca] ?? 0;
      if (da !== db) return db - da;
      return a.marca.localeCompare(b.marca);
    });
}

/**
 * Quante marche coprono la maggioranza dei subacquei.
 *
 * ► IL SELETTORE NON LA USA, e il commento diceva di sì. ◄ Doveva servirgli
 * «per decidere dove mettere il mostra tutte»; poi il selettore ha finito per
 * mostrarle tutte e venti, che con l'ordinamento per diffusione è la scelta
 * giusta — le rare stanno in fondo e chi le ha scrive il nome nella ricerca.
 *
 * Resta perché il numero che restituisce è il ragionamento di questo file
 * ridotto a una cifra: **quattro marche coprono l'81% dei subacquei.** È quello
 * che i test verificano, ed è quello che va riguardato il giorno in cui
 * qualcuno propone di ordinare l'elenco in un altro modo.
 */
export function marchePrincipali(soglia = 90): string[] {
  const out: string[] = [];
  let somma = 0;
  for (const { marca } of marchePerDiffusione()) {
    const q = DIFFUSIONE[marca] ?? 0;
    if (q === 0) break;
    out.push(marca);
    somma += q;
    if (somma >= soglia) break;
  }
  return out;
}

/**
 * Cerca fra tutti i modelli, per marca o per nome.
 *
 * Cercare è la strada più corta per chi sa già cosa ha al polso, ed è il motivo
 * per cui esiste anche con l'elenco ordinato bene: chi ha un Perdix scrive
 * «perdix» e ha finito, senza sapere che Shearwater è la prima marca.
 */
export function cercaModelli(testo: string): VoceCatalogo[] {
  const q = testo.trim().toLowerCase();
  if (!q) return [];
  const combacia = (m: VoceCatalogo) =>
    m.marca.toLowerCase().includes(q) || m.modello.toLowerCase().includes(q);
  /*
   * Le voci senza driver vengono DOPO quelle che si scaricano, sempre.
   *
   * Chi cerca «mk2» deve trovare prima i modelli con cui può fare qualcosa; chi
   * cerca «garmin» trova solo quelle, che è il punto. Metterle prima vorrebbe
   * dire mettere in cima all'elenco l'unica cosa che non funziona.
   */
  return [...MODELLI_BLE.filter(combacia), ...MODELLI_SENZA_BLE.filter(combacia)];
}

export { MODELLI_BLE };
export type { ModelloComputer };
