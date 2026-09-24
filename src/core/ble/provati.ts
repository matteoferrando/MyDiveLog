/**
 * I computer di terzi che **qualcuno ha acceso davvero**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE È NATO IL 16 SETTEMBRE 2026. ◄
 *
 * Quel giorno è arrivato il messaggio di una persona: *«Su Mares Quad Ci
 * funziona adesso.»* Il primo computer di terzi che ha consegnato immersioni
 * attraverso libdivecomputer in questa applicazione.
 *
 * ► E «PROVATO» SI AGGIUNGE UN MODELLO PER VOLTA. ◄ Lo stesso messaggio, due
 * righe sotto, diceva che un Aqualung i330R si era fermato a metà — e il
 * difetto era nostro.
 * *Un modello provato non è una famiglia provata, e nemmeno una libreria
 * provata.* Questo elenco cresce di una riga quando qualcuno accende un
 * apparecchio e racconta com'è andata, e di nessuna riga quando ci sembra che
 * dovrebbe funzionare.
 *
 * ► IL CONTRARIO NON SI SCRIVE. ◄ Dal 23 settembre 2026, per decisione del
 * proprietario, sotto i modelli che non sono in questo elenco il selettore
 * scrive solo la strada, «via libdivecomputer». Una frase che dice «non
 * l'abbiamo provato», ripetuta sotto ogni nome a chi sta per collegare il suo
 * computer, scoraggia invece di informare; `senzaMaiProvato.test.ts` la vieta
 * in tutto quello che si legge.
 *
 * ► COSA CONTA COME PROVA. ◄ Un apparecchio vero, acceso, che ha consegnato
 * immersioni. Non una prova automatica contro un flusso finto — quelle ci sono
 * e non dicono niente su come si comporta la radio di un modello che qui non
 * c'è. Non un «dovrebbe andare perché è della stessa famiglia».
 *
 * `quando` e `come` non sono decorazione: fra sei mesi la domanda sarà «chi
 * l'ha detto, e quando», e la risposta deve stare accanto all'affermazione.
 */

/** Un modello acceso davvero, una volta, da qualcuno. */
export interface ProvaSulCampo {
  marca: string;
  modello: string;
  /** Il giorno in cui è arrivata la notizia, in ISO. */
  quando: string;
  /** Da dove arriva. Niente nomi: chi segnala non ha chiesto di comparire. */
  come: string;
}

export const PROVATI_VIA_LDC: readonly ProvaSulCampo[] = [
  {
    marca: 'Mares',
    modello: 'Quad Ci',
    quando: '2026-09-16',
    come: 'segnalazione di chi usa l’applicazione: scarico riuscito',
  },
  {
    marca: 'Aqualung',
    modello: 'i330R',
    quando: '2026-09-23',
    come: 'segnalazione di chi usa l’applicazione, con le schermate: 71 immersioni arrivate in archivio',
  },
];

/**
 * Se qualcuno ha davvero acceso questo modello e l'ha raccontato.
 *
 * Marca e modello si confrontano senza badare alle maiuscole, perché arrivano
 * da due strade diverse: il catalogo generato dai descrittori e la scelta fatta
 * a schermo.
 */
export function provatoViaLdc(marca: string, modello: string): boolean {
  return PROVATI_VIA_LDC.some(
    (p) =>
      p.marca.toLowerCase() === marca.trim().toLowerCase() &&
      p.modello.toLowerCase() === modello.trim().toLowerCase(),
  );
}
