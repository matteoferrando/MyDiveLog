/**
 * L'attrezzatura incrociata con il resto del log.
 *
 * PERCHÉ UN FILE A PARTE. `gear.ts` risponde alle domande che si fanno
 * sull'inventario — quanti pezzi ho, quante immersioni ha fatto ognuno, quando
 * va revisionato. Qui si risponde a domande diverse, che l'inventario da solo
 * non può reggere perché hanno bisogno del profilo, della temperatura, della
 * salinità e del consumo: «con quale muta ho affrontato l'acqua più fredda»,
 * «quanti chili in dolce e quanti in salata», «con quale configurazione consumo
 * meno». Sono incroci, e vivono accanto alle altre statistiche.
 *
 * LA REGOLA CHE VALE PER TUTTE E TRE. Nessuna di queste tabelle dice «meglio» o
 * «peggio». Un consumo più basso con un erogatore può dipendere dall'erogatore,
 * o dal fatto che con quell'erogatore vai in posti meno profondi: per questo
 * ogni riga porta accanto la profondità mediana e il numero di immersioni su cui
 * è calcolata, che sono le due informazioni con cui si smonta una correlazione
 * finta. Il giudizio lo dà chi legge, con in testa cose che il log non sa.
 *
 * LE SOGLIE. Sotto le tre immersioni un gruppo non entra in tabella: una
 * mediana su due valori è il valore più fortunato dei due, e messa accanto a
 * una calcolata su trenta invita a un confronto che non regge. Chi vuole vedere
 * anche i gruppi piccoli abbassa `minDives`, ma il valore di partenza è tre e
 * l'interfaccia lo dichiara.
 */

import type { Dive } from '../model';
import { normalizzaNome, piastraDellImmersione, zavorraTotaleKg, type Equipment } from './gear';

// ---------------------------------------------------------------------------
// Attrezzi di cui si parla
// ---------------------------------------------------------------------------

/**
 * Il nome della muta di un'immersione, come va mostrato.
 *
 * Il riferimento all'inventario vince sul testo libero — è quello scelto da un
 * elenco, quindi scritto una volta sola e sempre uguale — ma il testo vale
 * eccome: le immersioni importate da LogTRAK hanno solo quello. La stessa
 * scelta che fa `equipmentUsage`, per lo stesso motivo.
 */
export function nomeMuta(d: Dive): string | undefined {
  const s = d.gear?.suit?.name?.trim() || d.suit?.trim();
  return s || undefined;
}

/** I nomi degli erogatori usati in un'immersione, senza ripetizioni. */
export function nomiErogatori(d: Dive): string[] {
  const visti = new Map<string, string>();
  for (const r of d.gear?.regulators ?? []) {
    const n = r?.name?.trim();
    if (n && !visti.has(normalizzaNome(n))) visti.set(normalizzaNome(n), n);
  }
  return [...visti.values()];
}

/**
 * Come si chiama la bombola di un'immersione, ai fini del confronto.
 *
 * Litri e materiale, perché sono le due cose che cambiano il comportamento in
 * acqua: dodici litri d'acciaio e undici d'alluminio non si portano allo stesso
 * modo, e mescolarli in una riga sola cancella proprio la differenza che si sta
 * cercando. Le immersioni con più di una bombola restano fuori: il consumo
 * complessivo non si può attribuire a una delle due, e attribuirlo alla prima
 * sarebbe un numero inventato.
 */
export function nomeBombola(d: Dive): string | undefined {
  if (d.cylinders.length !== 1) return undefined;
  const c = d.cylinders[0];
  if (c.sizeL === undefined) return undefined;
  const materiale =
    c.material === 'steel'
      ? 'acciaio'
      : c.material === 'alu'
        ? 'alluminio'
        : c.material === 'carbon'
          ? 'carbonio'
          : undefined;
  const litri = Number.isInteger(c.sizeL) ? String(c.sizeL) : c.sizeL.toFixed(1);
  return materiale ? `${litri} L ${materiale}` : `${litri} L`;
}

// ---------------------------------------------------------------------------
// Minuteria statistica
// ---------------------------------------------------------------------------

const mediana = (v: number[]): number | undefined => {
  if (!v.length) return undefined;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const arrotonda = (v: number | undefined, cifre = 1) =>
  v === undefined ? undefined : Math.round(v * 10 ** cifre) / 10 ** cifre;
const numeri = <T>(l: T[], f: (x: T) => number | undefined): number[] =>
  l.map(f).filter((v): v is number => v !== undefined && Number.isFinite(v));

/** Il mese locale dell'immersione, 1-12. Locale, perché è la stagione che conta. */
function meseLocale(d: Dive): number {
  const t = Date.parse(d.startTime);
  if (Number.isNaN(t)) return Number(d.startTime.slice(5, 7));
  return new Date(t + (d.utcOffsetMinutes ?? 0) * 60_000).getUTCMonth() + 1;
}

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/**
 * I mesi in cui una muta è stata usata, scritti come intervalli.
 *
 * «nov–apr» dice qualcosa che «nov, dic, gen, feb, mar, apr» non dice meglio, e
 * l'anno è circolare: una muta invernale usata da novembre ad aprile ha i mesi
 * 11, 12, 1, 2, 3, 4, e stampati in ordine numerico sembrerebbero due stagioni
 * diverse. Quindi il giro si chiude.
 */
export function stagioneTesto(mesi: number[]): string {
  const presenti = [...new Set(mesi)].sort((a, b) => a - b);
  if (!presenti.length) return '—';
  if (presenti.length === 12) return 'tutto l’anno';
  // Il buco più lungo fra due mesi consecutivi (in senso circolare) è il periodo
  // in cui la muta non si usa: la stagione è tutto il resto.
  let buco = -1;
  let dopo = 0;
  for (let i = 0; i < presenti.length; i++) {
    const a = presenti[i];
    const b = presenti[(i + 1) % presenti.length];
    const salto = (b - a + 12) % 12;
    if (salto > buco) {
      buco = salto;
      dopo = (i + 1) % presenti.length;
    }
  }
  const inizio = presenti[dopo];
  const fine = presenti[(dopo - 1 + presenti.length) % presenti.length];
  return inizio === fine ? MESI[inizio - 1] : `${MESI[inizio - 1]}–${MESI[fine - 1]}`;
}

// ---------------------------------------------------------------------------
// 1. Muta, temperatura e stagione
// ---------------------------------------------------------------------------

export interface RigaMutaTemperatura {
  suit: string;
  dives: number;
  /** Immersioni di questa muta che hanno la temperatura registrata. */
  tempBasis: number;
  medianTempC?: number;
  minTempC?: number;
  maxTempC?: number;
  /** I mesi in cui l'hai usata, come intervallo: «nov–apr». */
  stagione: string;
  medianMaxDepth?: number;
  medianDurationMin?: number;
}

/**
 * Con quale muta, a quale temperatura, in quale stagione.
 *
 * La riga che conta è `minTempC`: è l'acqua più fredda che hai davvero
 * affrontato con quella muta, e sapere che la umida da 5 mm è scesa una volta a
 * 14 °C dice più di qualunque mediana. Le mediane servono a dare il contesto —
 * quella muta è la tua muta da 24 °C — e la stagione a spiegare perché.
 */
export function mutaPerTemperatura(dives: Dive[], minDives = 3): RigaMutaTemperatura[] {
  const per = new Map<string, { nome: string; dives: Dive[] }>();
  for (const d of dives) {
    const nome = nomeMuta(d);
    if (!nome) continue;
    const k = normalizzaNome(nome);
    const g = per.get(k) ?? { nome, dives: [] };
    g.dives.push(d);
    per.set(k, g);
  }
  const out: RigaMutaTemperatura[] = [];
  for (const g of per.values()) {
    if (g.dives.length < minDives) continue;
    const temp = numeri(g.dives, (d) => d.minTempC);
    out.push({
      suit: g.nome,
      dives: g.dives.length,
      tempBasis: temp.length,
      medianTempC: arrotonda(mediana(temp)),
      minTempC: temp.length ? Math.min(...temp) : undefined,
      maxTempC: temp.length ? Math.max(...temp) : undefined,
      stagione: stagioneTesto(g.dives.map(meseLocale)),
      medianMaxDepth: arrotonda(mediana(numeri(g.dives, (d) => d.maxDepth))),
      medianDurationMin: arrotonda(mediana(numeri(g.dives, (d) => d.durationS / 60)), 0),
    });
  }
  // Dalla più calda alla più fredda: è l'ordine in cui una muta si sceglie.
  return out.sort((a, b) => (b.medianTempC ?? -99) - (a.medianTempC ?? -99));
}

/**
 * Le immersioni in cui eri vestito diversamente dal solito PER QUELLA
 * TEMPERATURA.
 *
 * Non «sbagliato»: diverso. Il criterio è la tua stessa abitudine — per ogni
 * fascia di temperatura si guarda quale muta usi di solito, e si segnalano le
 * immersioni in cui ne hai usata un'altra. Il valore non è il giudizio, è il
 * promemoria: la volta che sei sceso a 16 °C in umida te la ricordi, e vederla
 * scritta accanto alle altre dice se è stata un'eccezione o l'inizio di
 * un'abitudine.
 *
 * Le fasce sono di 4 °C perché più strette produrrebbero gruppi da una
 * immersione, dove «di solito» non significa niente.
 */
export interface FuoriAbitudine {
  dive: Dive;
  suit: string;
  tempC: number;
  /** La muta che usi di solito a questa temperatura. */
  /** La muta che usi di solito a questa temperatura. */
  solita: string;
  /**
   * Su quante immersioni si basa quel «di solito» — cioè quante volte hai usato
   * LA MUTA SOLITA in quella fascia, non quante immersioni ci sono in tutto.
   * Contando la fascia intera, «di solito Stagna» poteva reggersi su due
   * immersioni mentre la tabella sopra aveva già scartato quella muta per
   * insufficienza di dati.
   */
  base: number;
}

export function mutaFuoriAbitudine(dives: Dive[], minBase = 3): FuoriAbitudine[] {
  const fascia = (t: number) => Math.floor(t / 4) * 4;
  const conteggi = new Map<number, Map<string, { nome: string; n: number }>>();
  const utili: { d: Dive; nome: string; t: number }[] = [];
  for (const d of dives) {
    const nome = nomeMuta(d);
    if (!nome || d.minTempC === undefined || !Number.isFinite(d.minTempC)) continue;
    utili.push({ d, nome, t: d.minTempC });
    const f = fascia(d.minTempC);
    const m = conteggi.get(f) ?? new Map();
    const k = normalizzaNome(nome);
    const c = m.get(k) ?? { nome, n: 0 };
    c.n++;
    m.set(k, c);
    conteggi.set(f, m);
  }
  const out: FuoriAbitudine[] = [];
  for (const { d, nome, t } of utili) {
    const m = conteggi.get(fascia(t));
    if (!m) continue;
    const solita = [...m.values()].sort((a, b) => b.n - a.n)[0];
    if (normalizzaNome(solita.nome) === normalizzaNome(nome)) continue;
    // L'abitudine deve reggersi da sola: `minBase` si applica alle immersioni
    // con la muta SOLITA, non al totale della fascia.
    if (solita.n < minBase) continue;
    // Una muta che in quella fascia è comunque frequente non è un'eccezione.
    const mia = m.get(normalizzaNome(nome));
    if (mia && mia.n >= solita.n) continue;
    out.push({ dive: d, suit: nome, tempC: t, solita: solita.nome, base: solita.n });
  }
  return out.sort((a, b) => a.tempC - b.tempC);
}

// ---------------------------------------------------------------------------
// 2. Zavorra per muta e per tipo d'acqua
// ---------------------------------------------------------------------------

export interface RigaZavorra {
  suit: string;
  /** `salt`, `fresh`, o `undefined` quando l'immersione non lo dice. */
  salinity: 'salt' | 'fresh' | 'unknown';
  dives: number;
  medianKg: number;
  minKg: number;
  maxKg: number;
  /** Quante di queste immersioni portavano una piastra sommata alla zavorra. */
  withBackplate: number;
  medianTrimMpm?: number;
  trimBasis: number;
  /** La bombola usata più spesso in questo gruppo, quando è registrata. */
  bombolaPiuUsata?: string;
  /**
   * Su quante immersioni del gruppo si basa `bombolaPiuUsata`.
   *
   * Era l'unica colonna della scheda senza denominatore, e una immersione su
   * sei diventava «la bombola usata più spesso» senza che si potesse vedere.
   */
  bombolaBase: number;
}

/**
 * Quanti chili con quale muta, separando acqua dolce e salata.
 *
 * PERCHÉ LA SEPARAZIONE È IL PUNTO. Fra dolce e salata ci sono due o tre chili
 * di differenza per un subacqueo normale, e una mediana che le mescola cade in
 * mezzo: un numero che non è giusto in nessuna delle due situazioni, e che è
 * peggio di non avere il numero perché sembra una risposta. Separandole si
 * ottengono due righe che si possono usare davvero il giorno prima di partire.
 *
 * I chili sono sempre il TOTALE — zavorra più piastra — perché è quello che ti
 * tira giù. Accanto c'è su quante immersioni la piastra c'era, così una riga
 * gonfiata da tre immersioni in configurazione tecnica si riconosce.
 */
export function zavorraPerMutaEAcqua(
  dives: Dive[],
  minDives = 3,
  inventario?: Pick<Equipment, 'id' | 'plateKg' | 'backplateKg'>[],
): RigaZavorra[] {
  const per = new Map<string, { nome: string; sal: RigaZavorra['salinity']; dives: Dive[] }>();
  for (const d of dives) {
    const nome = nomeMuta(d);
    if (!nome) continue;
    // La soglia è sul TOTALE: una configurazione con la sola piastra e zero
    // piombo ha comunque una zavorra vera, e scartarla per `weightKg` mancante
    // butterebbe via proprio le immersioni tecniche. Vedi `weightingBySuit`.
    if (d.weightKg === undefined && piastraDellImmersione(d, inventario) === undefined) continue;
    if (!(zavorraTotaleKg(d, inventario) > 0)) continue;
    const sal: RigaZavorra['salinity'] =
      d.salinity === 'salt' ? 'salt' : d.salinity === 'fresh' ? 'fresh' : 'unknown';
    const k = `${normalizzaNome(nome)} ${sal}`;
    const g = per.get(k) ?? { nome, sal, dives: [] };
    g.dives.push(d);
    per.set(k, g);
  }
  const out: RigaZavorra[] = [];
  for (const g of per.values()) {
    if (g.dives.length < minDives) continue;
    const kg = g.dives.map((d) => zavorraTotaleKg(d, inventario));
    const trim = numeri(g.dives, (d) => d.metrics?.bottomVerticalTravelMpm);
    const bombole = new Map<string, number>();
    for (const d of g.dives) {
      const b = nomeBombola(d);
      if (b) bombole.set(b, (bombole.get(b) ?? 0) + 1);
    }
    const piuUsata = [...bombole.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({
      suit: g.nome,
      salinity: g.sal,
      dives: g.dives.length,
      medianKg: arrotonda(mediana(kg)) ?? 0,
      minKg: Math.min(...kg),
      maxKg: Math.max(...kg),
      withBackplate: g.dives.filter((d) => piastraDellImmersione(d, inventario)).length,
      medianTrimMpm: arrotonda(mediana(trim)),
      trimBasis: trim.length,
      bombolaPiuUsata: piuUsata?.[0],
      bombolaBase: piuUsata?.[1] ?? 0,
    });
  }
  return out.sort((a, b) => a.suit.localeCompare(b.suit) || a.salinity.localeCompare(b.salinity));
}

// ---------------------------------------------------------------------------
// 3. Consumo per attrezzo
// ---------------------------------------------------------------------------

export interface RigaConsumo {
  etichetta: string;
  dives: number;
  /** Immersioni del gruppo che hanno un consumo calcolabile. */
  rmvBasis: number;
  medianRmvLpm?: number;
  medianMaxDepth?: number;
  /**
   * La temperatura minima MEDIANA del gruppo — cioè la mediana delle minime, non
   * la più bassa. La colonna a schermo si chiamava «T minima» accanto a una
   * tabella in cui «La più fredda» è davvero un minimo: sulla stessa muta le due
   * dicevano 21 e 11 °C, e la prima è quella che rassicura.
   */
  medianTempC?: number;
  medianDurationMin?: number;
}

export interface TabellaConsumo {
  titolo: string;
  /** Cosa NON si può concludere da questa tabella, in una riga. */
  cautela: string;
  righe: RigaConsumo[];
  /** Immersioni del periodo che portano il dato di questo raggruppamento. */
  conIlDato: number;
}

/**
 * Il consumo raggruppato per attrezzo, con accanto quello che lo spiega.
 *
 * PERCHÉ PROFONDITÀ E TEMPERATURA SONO NELLA STESSA RIGA. Perché sono le due
 * cause che spiegano quasi ogni differenza di consumo, e senza di loro un
 * confronto fra attrezzi è una trappola: se l'erogatore che «consuma meno» è
 * quello che porti nelle immersioni da 15 metri in acqua calda, il merito non è
 * suo. Con le due colonne accanto la trappola si vede a occhio, e questo è il
 * massimo che una tabella può fare — il resto lo sa chi c'era.
 *
 * IL CONSUMO È RMV, litri al minuto in superficie: è già normalizzato per la
 * profondità, quindi il confronto fra righe ha senso. La profondità mediana
 * resta comunque accanto, perché normalizzare non è la stessa cosa che rendere
 * uguali due immersioni — il lavoro respiratorio in profondità cresce, e la
 * normalizzazione non lo sa.
 */
export function consumoPerAttrezzo(dives: Dive[], minDives = 3): TabellaConsumo[] {
  const tabella = (
    titolo: string,
    cautela: string,
    chiavi: (d: Dive) => string[],
  ): TabellaConsumo | undefined => {
    const per = new Map<string, { nome: string; dives: Dive[] }>();
    let conIlDato = 0;
    for (const d of dives) {
      const ks = chiavi(d);
      if (ks.length) conIlDato++;
      for (const nome of ks) {
        const k = normalizzaNome(nome);
        const g = per.get(k) ?? { nome, dives: [] };
        g.dives.push(d);
        per.set(k, g);
      }
    }
    const righe: RigaConsumo[] = [];
    for (const g of per.values()) {
      if (g.dives.length < minDives) continue;
      const rmv = numeri(g.dives, (d) => ((d.metrics?.rmvLpm ?? 0) > 0 ? d.metrics?.rmvLpm : undefined));
      righe.push({
        etichetta: g.nome,
        dives: g.dives.length,
        rmvBasis: rmv.length,
        medianRmvLpm: arrotonda(mediana(rmv)),
        medianMaxDepth: arrotonda(mediana(numeri(g.dives, (d) => d.maxDepth))),
        medianTempC: arrotonda(mediana(numeri(g.dives, (d) => d.minTempC))),
        medianDurationMin: arrotonda(mediana(numeri(g.dives, (d) => d.durationS / 60)), 0),
      });
    }
    // Serve un CONFRONTO: con un gruppo solo non c'è niente da confrontare, e la
    // riga singola invita a leggere quel numero come una proprietà dell'attrezzo.
    if (righe.length < 2) return undefined;
    righe.sort((a, b) => (a.medianRmvLpm ?? 99) - (b.medianRmvLpm ?? 99));
    return { titolo, cautela, righe, conIlDato };
  };

  return [
    tabella(
      'Erogatore',
      'Un erogatore ben regolato si respira meglio, ma la differenza che vedi qui è quasi sempre dove e quando lo usi.',
      nomiErogatori,
    ),
    tabella(
      'Muta',
      'Il freddo fa consumare di più, quindi la muta e la temperatura dicono in parte la stessa cosa: guarda le due colonne insieme.',
      (d) => {
        const n = nomeMuta(d);
        return n ? [n] : [];
      },
    ),
    tabella(
      'Bombola',
      'Litri e materiale non cambiano quanto respiri, cambiano quanto ti dura: se il consumo differisce, differiscono le immersioni in cui la porti.',
      (d) => {
        const n = nomeBombola(d);
        return n ? [n] : [];
      },
    ),
  ].filter((t): t is TabellaConsumo => t !== undefined);
}
