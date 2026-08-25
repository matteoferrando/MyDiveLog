/**
 * Le cose da sapere PRIMA della prossima immersione.
 *
 * PERCHÉ MANCAVA. Tutto il resto di questo progetto guarda indietro: le
 * statistiche dicono come sei andato, i suggerimenti dicono cosa migliorare, la
 * scheda dice cos'è successo. Nessuna pagina rispondeva alla sola domanda che ha
 * un termine — «domani vado sott'acqua: c'è qualcosa che devo sapere adesso?».
 * Le informazioni per rispondere c'erano tutte, sparse in quattro schede diverse:
 * l'azoto residuo nella scheda dell'immersione di stamattina, il numero di giorni
 * dall'ultima uscita nelle statistiche, la regola più urgente nei suggerimenti.
 *
 * COSA NON FA. Non inventa un punteggio complessivo e non dice «sei pronto» o «non
 * sei pronto»: mette in fila fatti che hanno un termine, ordinati per quanto stringe il
 * tempo, e lascia il giudizio a chi lo deve dare. Un semaforo verde su una schermata
 * è esattamente il genere di cosa che fa saltare i controlli veri.
 */

import type { Dive } from '../model';

import { CHAIN_BREAK_HOURS, entryStateFor } from './tissues';
import { cnsAfterSurface } from './oxygen';

export type NoteLevel = 'critical' | 'warning' | 'info' | 'good';

export interface NextDiveNote {
  id: string;
  level: NoteLevel;
  headline: string;
  detail: string;
  /** Dove andare per fare qualcosa: la scheda dell'app che riguarda la nota. */
  goTo?: 'logbook' | 'coach' | 'planner' | 'import';
  /** Quanto stringe: più basso, più in alto compare. */
  priority: number;
}

export interface NextDiveBriefing {
  notes: NextDiveNote[];
  /** Giorni dall'ultima immersione, se ce n'è una. */
  daysSinceLast?: number;
  /** Ore dall'ultima immersione, quando sono poche: serve al carico residuo. */
  hoursSinceLast?: number;
  /** Azoto ancora in circolo se scendessi adesso, bar sopra l'equilibrio. */
  residualN2Bar?: number;
  /** CNS residuo adesso, percentuale, dopo il dimezzamento in superficie. */
  residualCnsPct?: number;
  /** Le note che contano, già ordinate. */
}

/**
 * Il riepilogo di quello che riguarda la prossima immersione.
 *
 * `now` è un parametro e non `Date.now()` dentro la funzione: una funzione che
 * legge l'orologio da sola non si può provare, e qui il tempo è metà del
 * significato.
 */
export function nextDiveBriefing(
  dives: Dive[],
  topSuggestion: { headline: string; area: string } | undefined,
  now = Date.now(),
): NextDiveBriefing {
  const notes: NextDiveNote[] = [];

  const sorted = [...dives].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
  const last = sorted[0];
  const lastEnd = last ? Date.parse(last.startTime) + last.durationS * 1000 : undefined;
  const hoursSinceLast = lastEnd !== undefined ? (now - lastEnd) / 3600_000 : undefined;
  const daysSinceLast = hoursSinceLast !== undefined ? Math.floor(hoursSinceLast / 24) : undefined;

  /*
   * L'ATTREZZATURA NON COMPARE PIÙ QUI.
   *
   * C'erano quattro note — scaduto, in scadenza, senza data, elenco vuoto — e
   * insieme facevano di questa card un elenco di rimproveri su cose che chi
   * legge sa benissimo. Aprire il logbook per guardare le proprie immersioni e
   * trovare tre pallini rossi sul certificato medico è il modo in cui una
   * funzione utile diventa rumore che si impara a saltare, e quando poi arriva
   * la nota che conta davvero — l'azoto ancora in circolo — la si salta insieme
   * alle altre.
   *
   * La scelta è dichiarata: l'attrezzatura si registra e si consulta nella sua
   * scheda, dove i fatti stanno scritti senza giudizio. Questa card resta per
   * quello che nessun altro posto può dire: quanto tempo è passato dall'ultima
   * immersione, e quanto azoto e ossigeno hai ancora addosso.
   */

  // --- azoto e ossigeno ancora in circolo -----------------------------------
  let residualN2Bar: number | undefined;
  let residualCnsPct: number | undefined;
  if (last && hoursSinceLast !== undefined && hoursSinceLast < CHAIN_BREAK_HOURS) {
    // Una finta immersione che comincia adesso: è il modo di chiedere al modello
    // «con che tessuti entrerei in acqua in questo momento».
    const hypothetical: Dive = { ...last, id: '__ora__', startTime: new Date(now).toISOString() };
    const entry = entryStateFor(hypothetical, dives);
    residualN2Bar = entry.residualN2Bar;
    const cns = last.metrics?.cnsPct;
    if (cns !== undefined) residualCnsPct = cnsAfterSurface(cns, (now - lastEnd!) / 60_000);

    if (residualN2Bar > 0.02) {
      notes.push({
        id: 'residual',
        level: residualN2Bar > 0.15 ? 'warning' : 'info',
        headline: `Hai ancora ${residualN2Bar.toFixed(2)} bar di azoto in più del normale`,
        detail: `Sono passate ${fmtHours(hoursSinceLast)} dall'ultima immersione. Se scendi adesso non riparti da zero: la stessa immersione ti farà uscire più carico, e il computer lo terrà in conto.`,
        goTo: 'planner',
        priority: residualN2Bar > 0.15 ? 10 : 45,
      });
    }
    if (residualCnsPct !== undefined && residualCnsPct >= 20) {
      notes.push({
        id: 'residual-cns',
        level: residualCnsPct >= 50 ? 'warning' : 'info',
        headline: `Orologio CNS ancora al ${residualCnsPct.toFixed(0)}%`,
        detail:
          'Si dimezza ogni novanta minuti in superficie. Conta se la prossima è una immersione con miscele ricche o profonda: parte da qui, non da zero.',
        goTo: 'planner',
        priority: residualCnsPct >= 50 ? 12 : 50,
      });
    }
  }

  // --- quanto tempo è passato -----------------------------------------------
  if (daysSinceLast === undefined) {
    notes.push({
      id: 'no-dives',
      level: 'info',
      headline: 'Archivio vuoto',
      detail:
        'Importa un export dal tuo computer o dal logbook che usavi prima: da lì in poi tutto il resto si calcola da solo.',
      goTo: 'import',
      priority: 5,
    });
  } else if (daysSinceLast > 180) {
    notes.push({
      id: 'layoff',
      level: 'warning',
      headline: `${daysSinceLast} giorni dall'ultima immersione`,
      detail:
        'Dopo una pausa lunga la didattica consiglia un ripasso: la prima uscita facile, poco profonda, con qualcuno che ti conosce. L’assetto è la prima cosa che si perde e la più visibile nei numeri.',
      goTo: 'coach',
      priority: 15,
    });
  } else if (daysSinceLast > 60) {
    notes.push({
      id: 'rusty',
      level: 'info',
      headline: `${daysSinceLast} giorni dall'ultima immersione`,
      detail:
        'Non è una pausa lunga, ma la prima immersione dopo due mesi consuma sempre un po’ più del solito. Vale la pena saperlo prima di pianificare il gas al minuto.',
      goTo: 'planner',
      priority: 55,
    });
  }

  // --- la cosa su cui stai lavorando ----------------------------------------
  if (topSuggestion) {
    notes.push({
      id: 'focus',
      level: 'info',
      headline: `Su cosa lavorare: ${topSuggestion.headline}`,
      detail:
        'È la prima delle osservazioni sull’archivio. Una cosa sola per immersione: due non si tengono a mente sott’acqua.',
      goTo: 'coach',
      priority: 40,
    });
  }

  // La nota verde vale solo se NON c'è nient'altro da dire.
  //
  // Prima guardava solo le note critiche e di avviso, e finiva sopra a quelle
  // informative per via della priorità: la stessa schermata diceva, in
  // quest'ordine, «nessun carico residuo» e «hai ancora 0.10 bar di azoto in più
  // del normale». Adesso la condizione è che non ci sia proprio nulla, e il testo
  // dice quello che sa: niente residuo e niente da leggere.
  const somethingToSay = notes.some(
    (x) => x.level !== 'info' || x.id === 'residual' || x.id === 'residual-cns',
  );
  if (!somethingToSay) {
    notes.push({
      id: 'clear',
      level: 'good',
      headline: 'Niente in circolo',
      detail:
        'Nessun azoto residuo dall’immersione precedente e nessuna nota da leggere. Resta solo da decidere dove andare.',
      priority: 30,
    });
  }

  notes.sort((a, b) => a.priority - b.priority);
  return { notes, daysSinceLast, hoursSinceLast, residualN2Bar, residualCnsPct };
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} minuti`;
  if (h < 24) return `${h.toFixed(h < 3 ? 1 : 0)} ore`;
  return `${Math.floor(h / 24)} giorni`;
}
