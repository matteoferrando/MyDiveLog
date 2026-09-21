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
import {
  AIR,
  type Cylinder,
  type Dive,
  type DiveConditions,
  type DiveGear,
  type DiveMode,
  type GasMix,
  type Salinity,
} from './model';

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
  /** L'estremo alto della fascia di visibilità, quando è una fascia. */
  visibilityMaxM?: number;
  /** Il titolo che dai a questa immersione. */
  title?: string;
  /** La guida sub, distinta dal compagno. */
  guide?: string;
  /** Meteo e stato del mare, in forma contabile. */
  conditions?: DiveConditions;
  /** L'attrezzatura usata, agganciata all'inventario. */
  gear?: DiveGear;
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

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ► LE UNDICI FRASI CHE `NewDive` MOSTRA, E PERCHÉ SONO COSTANTI. ◄
 *
 * Nascono qui, in `core`, dove la lingua non si sa, e vengono tradotte dove si
 * disegnano — `NewDive.tsx` fa `t(e)` e `t(w)` su una variabile. Funziona a
 * schermo e **non funziona per la guardia**: `chiaviDi` (vedi
 * `tests/chiaviDelSorgente.ts`) vede solo una stringa letterale scritta subito
 * dopo la parentesi aperta di `t`, quindi di queste undici frasi non ne vede
 * nessuna, e
 * `tests/dizionario.test.ts` non può dire se una voce manchi.
 *
 * Ne mancava una — «Senza la profondità media i tessuti si stimano su un
 * profilo quadro.» — e il risultato a schermo era **una riga italiana in mezzo a
 * due inglesi**, nell'elenco di quello che manca a un'immersione scritta a mano.
 * Le altre dieci erano tradotte: non per una regola, per fortuna.
 *
 * Esportate e raccolte in un elenco, una prova può scorrerle tutte e pretendere
 * la voce inglese — la stessa cura di `core/ble/avanzamentoTesti.ts`,
 * `core/analysis/avvertenze.ts` e `ui/esporta.ts`, per lo stesso identico
 * motivo. *La prossima frase aggiunta qui non può più passare inosservata,
 * purché finisca nell'elenco in fondo.*
 */

/** Senza data l'immersione non ha posto nella catena delle ripetitive. */
export const SENZA_DATA =
  'Serve una data e un’ora: senza, l’immersione non ha posto nella catena delle ripetitive.';
/** Durata non positiva. */
export const DURATA_NON_VALIDA = 'La durata deve essere maggiore di zero.';
/** Profondità massima non positiva. */
export const PROFONDITA_NON_VALIDA = 'La profondità massima deve essere maggiore di zero.';
/** Media più profonda della massima: una delle due è sbagliata. */
export const MEDIA_OLTRE_LA_MASSIMA = 'La profondità media non può essere maggiore della massima.';
/** Ossigeno ed elio che superano il 100%. */
export const MISCELA_IMPOSSIBILE =
  'La miscela non torna: ossigeno ed elio insieme non possono superare il 100%.';
/** Pressione finale sopra quella iniziale. */
export const PRESSIONI_INVERTITE = 'La pressione finale non può essere maggiore di quella iniziale.';

/** Errori che impediscono di costruire l'immersione. */
export const ERRORI_DELLINSERIMENTO_A_MANO = [
  SENZA_DATA,
  DURATA_NON_VALIDA,
  PROFONDITA_NON_VALIDA,
  MEDIA_OLTRE_LA_MASSIMA,
  MISCELA_IMPOSSIBILE,
  PRESSIONI_INVERTITE,
] as const;

/**
 * Senza profondità media i tessuti si stimano su un profilo quadro.
 *
 * ► È LA FRASE CHE MANCAVA NEL DIZIONARIO. ◄ Il 70% e il perché stanno nel
 * suggerimento sotto il campo, in `NewDive`: qui, dentro l'elenco di quello che
 * manca, basta il fatto.
 */
export const SENZA_MEDIA_PROFILO_QUADRO =
  'Senza la profondità media i tessuti si stimano su un profilo quadro.';
/** Senza pressioni e volume il consumo non si calcola. */
export const SENZA_CONSUMO =
  'Senza le due pressioni e il volume della bombola il consumo non si può calcolare, e questa immersione resterà fuori dalle statistiche sul consumo.';
/** Senza temperatura non entra nelle correlazioni col freddo. */
export const SENZA_TEMPERATURA =
  'Senza temperatura questa immersione non entra nelle correlazioni fra freddo e consumo.';
/** Durata oltre le cinque ore: quasi sempre una battitura. */
export const DURATA_SOSPETTA =
  'Una durata sopra le cinque ore è quasi sempre un errore di battitura: controlla.';
/** Profondità oltre i cento metri: quasi sempre una battitura. */
export const PROFONDITA_SOSPETTA =
  'Una profondità sopra i 100 metri è quasi sempre un errore di battitura: controlla.';

/** Avvisi che non impediscono di salvare. */
export const AVVISI_DELLINSERIMENTO_A_MANO = [
  SENZA_MEDIA_PROFILO_QUADRO,
  SENZA_CONSUMO,
  SENZA_TEMPERATURA,
  DURATA_SOSPETTA,
  PROFONDITA_SOSPETTA,
] as const;

/**
 * Tutte quante, per la prova che le confronta col dizionario.
 *
 * Una costante nuova che non finisce in uno dei due elenchi qui sopra sfugge
 * alla guardia: è il solo punto debole del meccanismo, ed è scritto qui perché
 * chi aggiunge la prossima lo veda mentre lo fa.
 */
export const TESTI_DELLINSERIMENTO_A_MANO = [
  ...ERRORI_DELLINSERIMENTO_A_MANO,
  ...AVVISI_DELLINSERIMENTO_A_MANO,
] as const;

/** Errori che impediscono di costruire l'immersione. */
export function validateManualDive(input: Partial<ManualDiveInput>): string[] {
  const errors: string[] = [];
  const when = input.localDateTime
    ? Date.parse(localToUtcIso(input.localDateTime, input.utcOffsetMinutes))
    : NaN;
  if (!input.localDateTime || Number.isNaN(when)) errors.push(SENZA_DATA);
  if (!(Number(input.durationMin) > 0)) errors.push(DURATA_NON_VALIDA);
  if (!(Number(input.maxDepthM) > 0)) errors.push(PROFONDITA_NON_VALIDA);
  if (input.avgDepthM !== undefined && input.maxDepthM !== undefined && input.avgDepthM > input.maxDepthM) {
    errors.push(MEDIA_OLTRE_LA_MASSIMA);
  }
  const mix = input.mix;
  if (mix && (mix.o2 <= 0 || mix.o2 + mix.he > 1.0001)) errors.push(MISCELA_IMPOSSIBILE);
  if (input.startBar !== undefined && input.endBar !== undefined && input.endBar > input.startBar) {
    errors.push(PRESSIONI_INVERTITE);
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
  // Il match è riuscito: data, ore e minuti non sono opzionali, i secondi sì.
  const [, y, mo, d, h, mi, sec] = m as unknown as [string, string, string, string, string, string, string?];
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
  // Il match è riuscito, e nessuno dei cinque gruppi è opzionale.
  const [, y, mo, d, h, mi] = m as unknown as [string, string, string, string, string, string];
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

  if (avgDepth === undefined) warnings.push(SENZA_MEDIA_PROFILO_QUADRO);
  if (input.startBar === undefined || input.endBar === undefined || !input.tankSizeL) {
    warnings.push(SENZA_CONSUMO);
  }
  if (input.minTempC === undefined) warnings.push(SENZA_TEMPERATURA);
  if (input.durationMin > 300) warnings.push(DURATA_SOSPETTA);
  if (input.maxDepthM > 100) warnings.push(PROFONDITA_SOSPETTA);

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
    suit: clean(input.gear?.suit?.name) ?? clean(input.suit),
    visibilityM: input.visibilityM,
    visibilityMaxM: input.visibilityMaxM,
    title: clean(input.title),
    guide: clean(input.guide),
    conditions: input.conditions?.weather || input.conditions?.waves ? input.conditions : undefined,
    gear: input.gear && Object.values(input.gear).some((v) => v !== undefined) ? input.gear : undefined,
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
