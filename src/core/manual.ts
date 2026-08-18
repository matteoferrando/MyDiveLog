/**
 * Immersioni inserite a mano.
 *
 * Fino a ieri l'unico modo di far entrare un'immersione in archivio era un file.
 * Sembra ragionevole — è un logbook che legge dai computer — e invece è il difetto
 * che produceva i numeri più sbagliati dell'applicazione, per una ragione che non
 * ha niente a che vedere con la riga mancante nell'elenco.
 *
 * La catena dei tessuti si calcola sull'ARCHIVIO. Un'immersione che manca non è un
 * dato in meno: è azoto che nessuno ha contato, e la ripetitiva che la segue
 * eredita il carico di quella ancora prima, cioè un carico più basso del vero.
 * L'immersione col computer a noleggio, quella con la batteria scarica, quelle
 * ricopiate dal libretto di carta — tutte lasciavano quel buco, e il buco si
 * traduceva in un GF99 ottimista sull'immersione dopo. Le stesse diciannove
 * immersioni senza profilo dell'archivio di riferimento spezzavano la catena
 * diciannove volte.
 *
 * Questo modulo è puro di proposito: costruisce e valida, non salva. Chi salva è
 * `state.tsx`, che sa anche ricalcolare metriche e catena.
 */

import { diveIdFor } from './dedupe';
import { AIR, type Cylinder, type Dive, type DiveMode, type GasMix, type Salinity } from './model';

/**
 * Quello che una persona sa dire della propria immersione senza guardare un
 * computer. Non un `Dive` parziale: un `Dive` ha campi che nascono dal profilo e
 * che qui non possono esistere, e mescolarli inviterebbe a compilarli a mano.
 */
export interface ManualDiveInput {
  /** Data e ora locali del luogo, `YYYY-MM-DDTHH:mm`, come le scrive un `<input type="datetime-local">`. */
  localDateTime: string;
  /** Scarto del fuso del LUOGO rispetto a UTC, minuti. Assente = fuso di questo dispositivo. */
  utcOffsetMinutes?: number;
  durationMin: number;
  maxDepthM: number;
  /**
   * Profondità media. Facoltativa ma preziosa: è lei a determinare il profilo
   * quadro con cui si stimano i tessuti, e quindi il carico che passa
   * all'immersione successiva. Senza, si usa il 70% della massima.
   */
  avgDepthM?: number;
  minTempC?: number;
  siteName?: string;
  buddy?: string;
  mode?: DiveMode;
  salinity?: Salinity;
  mix?: GasMix;
  tankSizeL?: number;
  startBar?: number;
  endBar?: number;
  weightKg?: number;
  suit?: string;
  visibilityM?: number;
  /** Da 1 a 5, come nei logbook di carta. */
  rating?: number;
  notes?: string;
  tags?: string[];
  /** Numero progressivo scelto da chi scrive; se manca lo assegna il chiamante. */
  number?: number;
}

export interface ManualDiveResult {
  dive: Dive;
  /**
   * Problemi che NON impediscono di salvare ma che chi scrive deve vedere. Sono
   * separati dagli errori perché un logbook di carta è pieno di righe imprecise,
   * e rifiutarle significherebbe lasciarle fuori dall'archivio — cioè tornare al
   * buco nella catena che questo modulo esiste per chiudere.
   */
  warnings: string[];
}

/** Errori che impediscono di costruire l'immersione. */
export function validateManualDive(input: Partial<ManualDiveInput>): string[] {
  const errors: string[] = [];
  const when = input.localDateTime ? Date.parse(localToUtcIso(input.localDateTime, input.utcOffsetMinutes)) : NaN;
  if (!input.localDateTime || Number.isNaN(when)) {
    errors.push('Serve una data e un’ora: senza, l’immersione non ha posto nella catena delle ripetitive.');
  }
  if (!(Number(input.durationMin) > 0)) errors.push('La durata deve essere maggiore di zero.');
  if (!(Number(input.maxDepthM) > 0)) errors.push('La profondità massima deve essere maggiore di zero.');
  if (input.avgDepthM !== undefined && input.maxDepthM !== undefined && input.avgDepthM > input.maxDepthM) {
    errors.push('La profondità media non può essere maggiore della massima.');
  }
  const mix = input.mix;
  if (mix && (mix.o2 <= 0 || mix.o2 + mix.he > 1.0001)) {
    errors.push('La miscela non torna: ossigeno ed elio insieme non possono superare il 100%.');
  }
  if (input.startBar !== undefined && input.endBar !== undefined && input.endBar > input.startBar) {
    errors.push('La pressione finale non può essere maggiore di quella iniziale.');
  }
  return errors;
}

/**
 * Da un orario di orologio locale all'istante assoluto.
 *
 * `new Date('2026-06-01T09:00')` interpreta la stringa nel fuso della MACCHINA,
 * che è quasi sempre il fuso sbagliato: un'immersione alle Maldive inserita da
 * Milano finirebbe due ore avanti, e l'ordine delle ripetitive di quella giornata
 * cambierebbe. Quando lo scarto è dichiarato si usa quello; quando manca si usa
 * quello del dispositivo, perché è l'ipotesi meno sorprendente per chi sta
 * scrivendo adesso — ma resta un'ipotesi, e viene registrata in `utcOffsetMinutes`
 * così la scheda può mostrarla.
 */
export function localToUtcIso(localDateTime: string, utcOffsetMinutes?: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(localDateTime.trim());
  if (!m) return '';
  const [, y, mo, d, h, mi, sec] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, sec ? +sec : 0);
  if (utcOffsetMinutes === undefined) {
    // Il fuso del dispositivo, chiesto alla data GIUSTA: `getTimezoneOffset`
    // dipende dall'ora legale, e fra il 25 e il 26 ottobre c'è un'ora di
    // differenza. Chiederlo ad «adesso» sposterebbe di un'ora tutte le
    // immersioni estive inserite d'inverno.
    const offset = -new Date(+y, +mo - 1, +d, +h, +mi).getTimezoneOffset();
    return new Date(asUtc - offset * 60_000).toISOString();
  }
  return new Date(asUtc - utcOffsetMinutes * 60_000).toISOString();
}

/** Lo scarto del fuso di questo dispositivo a una certa data locale, minuti. */
export function deviceOffsetMinutes(localDateTime: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(localDateTime.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi] = m;
  return -new Date(+y, +mo - 1, +d, +h, +mi).getTimezoneOffset();
}

const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/**
 * Costruisce l'immersione.
 *
 * L'id esce da `diveIdFor`, cioè dalla STESSA firma orario+profondità+durata che
 * usano i parser. È deliberato: se un domani il file di quell'immersione salta
 * fuori — l'export del computer del compagno, il backup di Shearwater Cloud —
 * l'import la riconosce come la stessa e la arricchisce col profilo invece di
 * duplicarla, e `mergeDive` protegge già i campi compilati a mano. È il motivo per
 * cui vale la pena inserire un'immersione anche quando si spera di ritrovare il
 * file: il lavoro non va perso.
 */
export function buildManualDive(input: ManualDiveInput, now: Date = new Date()): ManualDiveResult {
  const warnings: string[] = [];
  const utcOffsetMinutes = input.utcOffsetMinutes ?? deviceOffsetMinutes(input.localDateTime);
  const startTime = localToUtcIso(input.localDateTime, utcOffsetMinutes);
  const durationS = Math.round(input.durationMin * 60);
  const maxDepth = Math.round(input.maxDepthM * 10) / 10;
  const avgDepth = input.avgDepthM !== undefined ? Math.round(input.avgDepthM * 10) / 10 : undefined;

  if (avgDepth === undefined) {
    warnings.push(
      'Senza profondità media i tessuti verranno stimati su un profilo quadro al 70% della massima. Se te la ricordi, scrivila: è il numero che decide quanto azoto passa all’immersione successiva.',
    );
  }
  if (input.startBar === undefined || input.endBar === undefined || !input.tankSizeL) {
    warnings.push(
      'Senza le due pressioni e il volume della bombola il consumo non si può calcolare, e questa immersione resterà fuori dalle statistiche sul consumo.',
    );
  }
  if (input.minTempC === undefined) {
    warnings.push('Senza temperatura questa immersione non entra nelle correlazioni fra freddo e consumo.');
  }
  if (input.durationMin > 300) {
    warnings.push('Una durata sopra le cinque ore è quasi sempre un errore di battitura: controlla.');
  }
  if (input.maxDepthM > 100) {
    warnings.push('Una profondità sopra i 100 metri è quasi sempre un errore di battitura: controlla.');
  }

  const mix = input.mix ?? AIR;
  const cylinder: Cylinder = {
    mix,
    sizeL: input.tankSizeL,
    startBar: input.startBar,
    endBar: input.endBar,
  };

  const tags = [...(input.tags ?? [])];
  if (mix.o2 > 0.22 && !tags.includes('nitrox')) tags.push('nitrox');
  if (mix.he > 0 && !tags.includes('trimix')) tags.push('trimix');

  const dive: Dive = {
    id: diveIdFor({ startTime, maxDepth, durationS }),
    updatedAt: now.toISOString(),
    number: input.number,
    startTime,
    utcOffsetMinutes,
    durationS,
    maxDepth,
    avgDepth,
    minTempC: input.minTempC,
    site: clean(input.siteName) ? { name: clean(input.siteName)! } : undefined,
    buddy: clean(input.buddy),
    mode: input.mode ?? 'oc',
    salinity: input.salinity ?? 'salt',
    cylinders: [cylinder],
    weightKg: input.weightKg,
    suit: clean(input.suit),
    visibilityM: input.visibilityM,
    rating: input.rating,
    notes: clean(input.notes),
    tags,
    source: {
      format: 'manual',
      // Non un nome di file inventato: chi legge la provenienza deve capire in
      // un colpo d'occhio che dietro non c'è nessun file da ritrovare.
      file: 'inserita a mano',
      importedAt: now.toISOString(),
    },
  };

  return { dive, warnings };
}
