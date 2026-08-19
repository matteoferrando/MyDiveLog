/**
 * Da come chiami una bombola a quanti litri è.
 *
 * IL PROBLEMA. «S80» non è una misura, è un nome commerciale, e il numero che
 * contiene non è il volume: sono i piedi cubi di GAS che la bombola eroga alla
 * sua pressione di lavoro. Il volume d'acqua — l'unico numero con cui si fa
 * l'aritmetica del gas — è un'altra cosa, e per giunta il nome commerciale
 * mente anche sui piedi cubi: la Luxfer chiamata «80» ne dà 77,4.
 *
 * Chi scrive «S80» nel logbook sa benissimo che bombola è; è l'applicazione che
 * deve saperlo tradurre, invece di chiedere un numero che nessuno ricorda a
 * memoria. E deve tradurlo BENE: sbagliare i litri non dà nessun errore, dà un
 * consumo in L/min sbagliato della stessa percentuale, su tutte le immersioni
 * fatte con quella bombola, per sempre.
 *
 * DUE STRADE, e la differenza fra le due è dichiarata a chi guarda.
 *
 *  1. **La tabella.** Le bombole in alluminio Luxfer sono una serie sola, sono
 *     ovunque nel mondo del noleggio, e i loro volumi interni sono pubblicati
 *     dal costruttore. Lì il numero è quello vero.
 *  2. **La formula**, per tutto il resto: `litri = piedi cubi × 28,3168 /
 *     pressione in bar`. È l'inversione della legge dei gas ideali, quindi è
 *     una stima — sopra i 200 bar l'aria non è ideale e il volume vero è
 *     qualche punto percentuale sotto. Va benissimo per non partire da zero, e
 *     non va spacciata per un dato di targa: chi la usa lo legge scritto.
 *
 * Quello che NON si fa è indovinare i volumi delle bombole in acciaio. Le sigle
 * «HP100», «LP85» sono nomi di famiglie diverse per costruttore, con pressioni
 * di lavoro diverse — e un numero inventato con l'aria di essere di targa è
 * peggio di un campo vuoto, perché nessuno lo va a controllare.
 */

/** Piedi cubi in litri. */
const L_PER_CUFT = 28.316846592;

/** 3000 psi, la pressione di lavoro della serie in alluminio. */
const BAR_3000_PSI = 206.8;

export interface CylinderSpec {
  /** Volume d'acqua, litri. */
  sizeL: number;
  /** Pressione di lavoro dichiarata, bar. */
  workPressureBar?: number;
  material?: 'steel' | 'alu' | 'carbon';
  /** Come si è arrivati al numero: si mostra a chi compila. */
  from: 'tabella' | 'formula' | 'litri';
  /** Una riga da mostrare accanto al campo. */
  note: string;
}

/**
 * La serie in alluminio Luxfer: volume interno reale, non il nome.
 *
 * I numeri sono quelli di targa del costruttore. Si vede subito perché la
 * formula non basterebbe: la «80» darebbe 10,95 L applicandola al nome, e sono
 * 11,1 — un errore dell'1,4% su ogni consumo calcolato, sempre nella stessa
 * direzione.
 */
const ALLUMINIO: Record<number, { sizeL: number; barP: number }> = {
  13: { sizeL: 1.8, barP: BAR_3000_PSI },
  19: { sizeL: 2.7, barP: BAR_3000_PSI },
  30: { sizeL: 4.3, barP: BAR_3000_PSI },
  40: { sizeL: 5.7, barP: BAR_3000_PSI },
  50: { sizeL: 7.1, barP: BAR_3000_PSI },
  63: { sizeL: 9.0, barP: BAR_3000_PSI },
  72: { sizeL: 10.4, barP: 138.9 },
  80: { sizeL: 11.1, barP: BAR_3000_PSI },
  100: { sizeL: 13.2, barP: 227.5 },
};

const arrotonda = (v: number) => Math.round(v * 10) / 10;

/**
 * I limiti oltre i quali un volume non è una bombola, ma un errore di battitura.
 *
 * PERCHÉ SERVONO, e perché il minimo conta più del massimo. Un volume SBAGLIATO
 * è molto peggio di un campo vuoto: entra nel calcolo del consumo e lo falsa
 * della stessa percentuale su quella immersione, per sempre, senza un errore a
 * schermo. E lo ZERO è il caso peggiore di tutti, perché non è un buco: è un
 * valore, e la fusione fra due import riempie solo i campi indefiniti — uno zero
 * blocca per sempre il volume vero che arriverebbe dal file successivo.
 *
 * La sigla in alluminio senza limiti produceva numeri piccoli e credibili:
 * «S12» dava 1.6 L, che è la taglia di una vera bombolina di scorta, e un
 * consumo di 2 L/min invece di 15. Nessuno lo avrebbe messo in dubbio.
 */
const MIN_LITRI = 0.5;
const MAX_LITRI = 60;

/** Il volume, se è un volume; `undefined` se è più probabilmente un errore. */
function plausibile(litri: number): number | undefined {
  const v = arrotonda(litri);
  return Number.isFinite(v) && v >= MIN_LITRI && v <= MAX_LITRI ? v : undefined;
}

/**
 * Interpreta quello che è stato scritto nel campo della bombola.
 *
 * Accetta le forme che la gente usa davvero: «S80», «AL80», «al 80», «11.1 L»,
 * «12», «D12», «80 cuft», «2×12». Restituisce `undefined` quando non capisce,
 * che è il comportamento giusto: lasciare il campo vuoto e far scrivere il
 * numero è meglio che riempirlo con una supposizione.
 */
export function parseCylinderSpec(testo: string | undefined | null): CylinderSpec | undefined {
  if (!testo) return undefined;
  const t = testo.trim().toLowerCase().replace(',', '.');
  if (!t) return undefined;

  /*
   * I bibombola si riconoscono e si RIFIUTANO, non si dimezzano né si
   * raddoppiano in silenzio.
   *
   * «D12» e «2x12» sono due bombole da dodici litri collegate: ventiquattro
   * litri di gas. Ma `Cylinder.sizeL` in questo modello è il volume di UNA
   * bombola, e il resto del programma conta le bombole dall'elenco. Indovinare
   * qui vorrebbe dire raddoppiare due volte o non raddoppiare affatto, e in
   * tutti e due i casi senza che si veda. Si dice quanto vale il singolo e si
   * lascia decidere.
   */
  const bi = /^(?:d|2\s*[x×]\s*)(\d+(?:\.\d+)?)$/.exec(t);
  if (bi) {
    const uno = plausibile(Number(bi[1]));
    if (uno === undefined) return undefined;
    return {
      sizeL: uno,
      from: 'litri',
      note: `bibombola: ${uno} L per bombola. Se le conti come una sola, il volume è ${arrotonda(uno * 2)} L.`,
    };
  }

  // «S80», «AL80», «al 80»: la serie in alluminio.
  const alu = /^(?:s|al|alu)\s*[- ]?\s*(\d+)$/.exec(t);
  if (alu) {
    const nome = Number(alu[1]);
    const dati = ALLUMINIO[nome];
    if (dati) {
      return {
        sizeL: dati.sizeL,
        workPressureBar: Math.round(dati.barP),
        material: 'alu',
        from: 'tabella',
        note: `alluminio ${nome} cuft: ${dati.sizeL} L d'acqua a ${Math.round(dati.barP)} bar, dal dato di targa.`,
      };
    }
    /*
     * UNA SIGLA FUORI TABELLA NON SI STIMA: si lascia il campo vuoto.
     *
     * È la trappola peggiore di tutto questo file, e l'ho scoperta provandola.
     * «S12» stimato con la formula dà 1,6 L — la taglia di una vera bombolina di
     * scorta, quindi un numero che nessuno mette in dubbio — e il consumo di
     * quella immersione diventa 2 L/min invece di 15.
     *
     * Ma chi scrive «S12» in Italia intende quasi certamente una **dodici litri
     * d'acciaio**, non dodici piedi cubi: la sigla `S<n>` è americana e lì `n`
     * sono i piedi cubi, mentre da noi le bombole si chiamano coi litri. La
     * stessa stringa vuol dire due cose diverse a seconda di chi la scrive, e non
     * c'è modo di sapere quale.
     *
     * Quindi la traduzione vale SOLO per le misure che esistono davvero nella
     * serie Luxfer, dove `S<n>` non è ambiguo. Per tutto il resto il campo resta
     * vuoto e i litri li scrive chi sa che bombola ha: un campo vuoto si nota, un
     * numero sbagliato no.
     */
    return undefined;
  }

  // «80 cuft», «80cf»: piedi cubi espliciti, pressione di lavoro non nota.
  const cuft = /^(\d+(?:\.\d+)?)\s*(?:cuft|cf|ft3|piedi)$/.exec(t);
  if (cuft) {
    const valore = Number(cuft[1]);
    if (!Number.isFinite(valore) || valore <= 0) return undefined;
    const stima = plausibile((valore * L_PER_CUFT) / BAR_3000_PSI);
    if (stima === undefined) return undefined;
    return {
      sizeL: stima,
      from: 'formula',
      note: `${valore} cuft a 207 bar fanno circa ${stima} L: stima dalla formula. Se la bombola lavora a una pressione diversa, il volume cambia.`,
    };
  }

  // «11.1 l», «12 litri», «12»: già litri.
  const litri = /^(\d+(?:\.\d+)?)\s*(?:l|lt|litri|liters?)?$/.exec(t);
  if (litri) {
    const v = plausibile(Number(litri[1]));
    return v === undefined ? undefined : { sizeL: v, from: 'litri', note: '' };
  }

  return undefined;
}

/** Le sigle da proporre in un elenco, con il loro volume. */
export const SIGLE_NOTE = Object.entries(ALLUMINIO).map(([nome, d]) => ({
  sigla: `S${nome}`,
  sizeL: d.sizeL,
  etichetta: `S${nome} — ${d.sizeL} L (alluminio)`,
}));
