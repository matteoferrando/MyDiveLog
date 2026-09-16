/**
 * I computer di terzi che **qualcuno ha acceso davvero**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► PERCHÉ QUESTO FILE È NATO IL 17 SETTEMBRE 2026. ◄
 *
 * Per tre settimane, sotto ogni modello che passa da libdivecomputer, il
 * selettore ha scritto *«via libdivecomputer, mai provato su questo modello»*.
 * Non era una formula di cortesia: era la verità, e in `Cargo.toml` c'era
 * scritto che andava tolta solo quando avesse smesso di esserlo.
 *
 * Quel giorno è arrivato con un messaggio di una persona: *«Su Mares Quad Ci
 * funziona adesso.»*
 *
 * ► E VA TOLTA UN MODELLO PER VOLTA. ◄ Lo stesso messaggio, due righe sotto,
 * diceva che un Aqualung i330R si era fermato a metà — e il difetto era nostro.
 * *Un modello provato non è una famiglia provata, e nemmeno una libreria
 * provata.* Questo elenco cresce di una riga quando qualcuno accende un
 * apparecchio e racconta com'è andata, e di nessuna riga quando ci sembra che
 * dovrebbe funzionare.
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
    quando: '2026-09-17',
    come: 'segnalazione di chi usa l’applicazione: scarico riuscito',
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
