/**
 * Il libretto delle immersioni come lo vuole la legge italiana.
 *
 * ► DA DOVE VIENE. ◄ Legge 7 maggio 2026, n. 70 («Valorizzazione della risorsa
 * mare»), art. 12, comma 8: il subacqueo deve essere dotato di un libretto delle
 * immersioni «nel quale devono essere annotati, **anche in formato digitale**»,
 * tredici dati, dalla lettera a) alla lettera o) — l'italiano giuridico salta la
 * j e la k. Il formato digitale è ammesso dal testo, non tollerato per
 * interpretazione: è per questo che un'applicazione può essere il libretto e non
 * solo un promemoria di quello di carta.
 *
 * ► COSA FA QUESTO FILE, E COSA NON FA. ◄ Prende un'immersione e il profilo di
 * chi la registra e restituisce le tredici voci NELL'ORDINE DELLA LEGGE, ognuna
 * con la sua lettera. Non decide come mostrarle — quello è affare della stampa —
 * e soprattutto **non riempie i buchi**: un dato che non c'è esce `null`, e chi
 * disegna scrive un trattino. Su un documento che qualcuno controfirma, un
 * valore inventato è peggio di un valore mancante.
 *
 * ► PERCHÉ NON SI VALIDA NIENTE. ◄ Nessun campo è obbligatorio, nessun avviso
 * rosso, nessun blocco. Due ragioni, e la seconda pesa più della prima. La
 * prima: le lettere m), n) e o) presuppongono un centro e una guida, e
 * un'immersione fra amici non li ha. La seconda: il comma 8 sta dentro
 * l'articolo che disciplina i CENTRI, e se l'obbligo valga anche per chi si
 * immerge per conto proprio il testo non lo dice — non ci sono ancora prassi né
 * giurisprudenza. Un'applicazione che trasformasse un'ambiguità in un errore
 * rosso starebbe dando un parere legale al posto di un avvocato.
 *
 * `mancanti()` esiste per la ragione opposta: chi VUOLE il libretto completo
 * deve poter vedere cosa gli manca, senza che nessuno glielo imponga.
 */

import { comeSta, type Traduci } from './traduci';
import type { Dive } from './model';
import { mixName } from './units';

/**
 * Chi tiene il libretto: lettere a) e b).
 *
 * Non sta dentro l'immersione perché non cambia a ogni immersione — cambia una
 * volta ogni qualche anno, quando si prende un brevetto nuovo. Sta nelle
 * impostazioni, e da lì entra in ogni pagina stampata.
 */
export interface Subacqueo {
  /** Nome e cognome. La legge dice «generalità». */
  nome?: string;
  /** Il brevetto posseduto: livello e organizzazione, come sta scritto sul cartellino. */
  brevetto?: string;
}

/** Una delle tredici voci, con la lettera che le dà la legge. */
export interface VoceLibretto {
  /** `a`, `b`, `c`, … `o`. Senza `j` e senza `k`: non è un errore, è l'alfabeto giuridico italiano. */
  lettera: string;
  /** L'etichetta da mostrare, già tradotta. */
  etichetta: string;
  /** Il valore, oppure `null` quando non c'è. Mai una stringa vuota, mai un valore finto. */
  valore: string | null;
}

/** Due cifre, per gli orari. */
function due(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * L'ora nel fuso del LUOGO dell'immersione.
 *
 * La stessa scelta che fa tutto il resto dell'applicazione: l'orario di
 * un'immersione è quello che segnava il computer al polso, non quello di casa.
 * Su un libretto che può finire davanti a un'autorità, un'immersione delle 9 del
 * mattino in Mar Rosso non deve comparire come delle 8.
 */
function ora(iso: string, offsetMinutes?: number): string | null {
  const quando = Date.parse(iso);
  if (Number.isNaN(quando)) return null;
  const spostato = new Date(quando + (offsetMinutes ?? 0) * 60_000);
  return `${due(spostato.getUTCHours())}:${due(spostato.getUTCMinutes())}`;
}

/** La data nel fuso del luogo, in forma italiana. */
function data(iso: string, offsetMinutes?: number): string | null {
  const quando = Date.parse(iso);
  if (Number.isNaN(quando)) return null;
  const spostato = new Date(quando + (offsetMinutes ?? 0) * 60_000);
  return `${due(spostato.getUTCDate())}/${due(spostato.getUTCMonth() + 1)}/${spostato.getUTCFullYear()}`;
}

/**
 * Il tipo di autorespiratore, lettera g).
 *
 * La legge chiede il TIPO, non la marca: circuito aperto, semichiuso, chiuso. È
 * quello che `mode` sa già dire. L'apnea non è un autorespiratore e infatti
 * restituisce `null` invece di una parola a caso, e il computer «gauge» dice
 * come registrava lo strumento, non cosa respirava la persona.
 */
function autorespiratore(dive: Dive, t: Traduci): string | null {
  switch (dive.mode) {
    case 'oc':
      return t('Autorespiratore a circuito aperto (ARA)');
    case 'ccr':
      return t('Rebreather a circuito chiuso (CCR)');
    case 'scr':
      return t('Rebreather a circuito semichiuso (SCR)');
    default:
      return null;
  }
}

/** Le miscele respirate, lettera h): tutte, separate, senza doppioni. */
function miscele(dive: Dive): string | null {
  const nomi = (dive.cylinders ?? [])
    .map((c) => (c.mix ? mixName(c.mix) : undefined))
    .filter((n): n is string => !!n);
  const distinte = [...new Set(nomi)];
  return distinte.length ? distinte.join(' · ') : null;
}

/** Metri con una cifra, o `null`. Lo zero non è «niente»: si scrive. */
function metri(valore: number | undefined): string | null {
  if (valore === undefined || !Number.isFinite(valore)) return null;
  return `${valore.toFixed(1)} m`;
}

/** Il luogo, lettera d): sito, zona e paese quando ci sono. */
function localita(dive: Dive): string | null {
  const pezzi = [dive.site?.name, dive.site?.region, dive.site?.country].filter(
    (s): s is string => !!s && s.trim().length > 0,
  );
  return pezzi.length ? pezzi.join(', ') : null;
}

/**
 * Le tredici voci, nell'ordine della legge.
 *
 * L'ordine NON è un dettaglio estetico: chi controlla un libretto scorre le
 * lettere, e trovarle mescolate costringe a cercare. È anche il motivo per cui
 * la lettera viaggia insieme al valore invece di essere dedotta dalla posizione.
 */
export function libretto(dive: Dive, chi: Subacqueo = {}, t: Traduci = comeSta): VoceLibretto[] {
  const fine = (() => {
    const inizio = Date.parse(dive.startTime);
    if (Number.isNaN(inizio) || !Number.isFinite(dive.durationS)) return null;
    return ora(new Date(inizio + dive.durationS * 1000).toISOString(), dive.utcOffsetMinutes);
  })();

  const pulito = (s: string | undefined) => {
    const v = s?.trim();
    return v ? v : null;
  };

  return [
    { lettera: 'a', etichetta: t('Generalità del subacqueo'), valore: pulito(chi.nome) },
    { lettera: 'b', etichetta: t('Brevetto posseduto'), valore: pulito(chi.brevetto) },
    {
      lettera: 'c',
      etichetta: t('Data dell’immersione'),
      valore: data(dive.startTime, dive.utcOffsetMinutes),
    },
    { lettera: 'd', etichetta: t('Località'), valore: localita(dive) },
    { lettera: 'e', etichetta: t('Orario di inizio'), valore: ora(dive.startTime, dive.utcOffsetMinutes) },
    { lettera: 'f', etichetta: t('Orario di fine'), valore: fine },
    { lettera: 'g', etichetta: t('Tipo di autorespiratore'), valore: autorespiratore(dive, t) },
    { lettera: 'h', etichetta: t('Miscela respiratoria'), valore: miscele(dive) },
    { lettera: 'i', etichetta: t('Profondità massima programmata'), valore: metri(dive.plannedMaxDepth) },
    { lettera: 'l', etichetta: t('Profondità massima raggiunta'), valore: metri(dive.maxDepth) },
    { lettera: 'm', etichetta: t('Centro di immersione'), valore: pulito(dive.center) },
    { lettera: 'n', etichetta: t('Istruttore o guida responsabile'), valore: pulito(dive.guide) },
    /*
     * La firma non è un dato: è un gesto. Qui resta sempre vuota, e la stampa
     * ci lascia la riga. Una casella «firmato: sì» compilata da chi tiene il
     * libretto non è la firma di nessuno — sarebbe l'esatto contrario di quello
     * che la lettera o) chiede.
     */
    { lettera: 'o', etichetta: t('Firma dell’istruttore o della guida'), valore: null },
  ];
}

/** Le lettere che restano vuote. Per chi vuole sapere, non per chi deve obbedire. */
export function mancanti(voci: VoceLibretto[]): string[] {
  return voci.filter((v) => v.valore === null).map((v) => v.lettera);
}
