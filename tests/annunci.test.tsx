// @vitest-environment jsdom
/**
 * Quello che succede, detto a chi non guarda lo schermo.
 *
 * PERCHÉ ESISTE. Tre punti dell'applicazione fanno partire un'operazione che
 * dura — leggere una manciata di file, chiedere un'analisi a Claude, ricalcolare
 * il piano di miglioramento — e finché non finisce cambiano solo cose che si
 * vedono: il testo di un pulsante, un flusso di testo che cresce, una tabella che
 * compare in fondo alla pagina. Nessuna di queste è udibile. Con uno screen
 * reader si premeva un pulsante e da lì in poi non arrivava più niente: non se era
 * partito, non se era finito, non se era fallito — e nel caso peggiore, quello
 * dell'analisi, l'attesa muta dura mezzo minuto.
 *
 * COSA VERIFICA. Le tre regioni live nei TRE momenti, eseguendo davvero il
 * componente e portandolo attraverso gli stati con una promessa che il test
 * decide quando risolvere:
 *
 *  1. la regione esiste PRIMA che l'operazione parta, e vuota. Non è un
 *     dettaglio: una regione live creata insieme al testo che deve annunciare
 *     viene ignorata da diversi screen reader, ed è il modo più comune di
 *     scrivere un annuncio che non annuncia niente;
 *  2. l'annuncio dice i NUMERI che il componente ha già in mano — file letti,
 *     immersioni nuove, parole e token dell'analisi, percentuale di prontezza —
 *     e non «operazione completata»;
 *  3. il fallimento passa da `role="alert"` e non da `role="status"`, e il
 *     messaggio d'errore NON viene detto due volte: dov'è già scritto a schermo
 *     è il contenitore visibile a essere marcato live, non una copia nascosta.
 *
 * L'archivio è mockato: qui non si verifica l'import né l'API di Anthropic — ci
 * pensano altri file — ma solo cosa viene annunciato mentre quelli lavorano.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { computeMetrics } from '../src/core/analysis/metrics';
import { aggregate } from '../src/core/analysis/aggregate';
import { buildPlan, type Plan } from '../src/core/analysis/coaching';
import { periodOf } from '../src/core/analysis/window';
import { AIR, type Dive, type Sample } from '../src/core/model';
import { int } from '../src/ui/format';
import type { ImportOutcome, StoredAnalysis } from '../src/ui/state';

/**
 * L'archivio finto.
 *
 * Vive in `vi.hoisted` perché la fabbrica del mock viene issata sopra gli import:
 * il contenitore deve esistere prima, il contenuto glielo mette ogni test.
 */
const finto = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('../src/ui/state', () => ({ useDiveLog: () => finto.valore }));

import { ImportPage } from '../src/ui/pages/ImportPage';
import { AnalysisCard } from '../src/ui/components/Analysis';
import { Coach } from '../src/ui/pages/Coach';

// ---------------------------------------------------------------------------
// Attrezzi
// ---------------------------------------------------------------------------

function monta(nodo: ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(nodo));
  return {
    host,
    aggiorna: (n: ReactNode) => act(() => root.render(n)),
    smonta: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** La regione cortese e quella assertiva, con il testo che dicono adesso. */
const stato = (host: HTMLElement, i = 0) =>
  host.querySelectorAll('[role="status"]')[i]?.textContent ?? '(nessuna regione status)';
const allarme = (host: HTMLElement, i = 0) =>
  host.querySelectorAll('[role="alert"]')[i]?.textContent ?? '(nessuna regione alert)';

/**
 * Una promessa che il test risolve quando vuole.
 *
 * È l'unico modo di fermare il componente nel mezzo — «l'operazione è partita e
 * non è ancora finita» — che è precisamente lo stato che prima non veniva
 * annunciato.
 */
function differita<T>() {
  let risolvi!: (v: T) => void;
  let rifiuta!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    risolvi = res;
    rifiuta = rej;
  });
  return { promessa, risolvi, rifiuta };
}

/** Sgancia dei file sulla zona di trascinamento, come farebbe il mouse. */
function sganciaFile(host: HTMLElement, nomi: string[]) {
  const zona = host.querySelector('.dropzone');
  if (!zona) throw new Error('la pagina di import non ha la zona di trascinamento');
  const evento = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(evento, 'dataTransfer', {
    value: { files: nomi.map((n) => new File(['contenuto'], n)) },
  });
  act(() => {
    zona.dispatchEvent(evento);
  });
}

function premi(host: HTMLElement, etichetta: string) {
  const bottone = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(etichetta));
  if (!bottone) throw new Error(`nessun pulsante con «${etichetta}»`);
  act(() => {
    bottone.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return bottone;
}

const esito = (over: Partial<ImportOutcome> = {}): ImportOutcome => ({
  fileName: 'log.uddf',
  ok: true,
  found: 0,
  added: 0,
  merged: 0,
  duplicates: 0,
  warnings: [],
  ...over,
});

beforeEach(() => {
  finto.valore = {};
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

describe('annunci della pagina di import', () => {
  const archivioFinto = (importFiles: (f: File[]) => Promise<ImportOutcome[]>, dives = 0) => {
    finto.valore = {
      dives: Array.from({ length: dives }, () => ({})),
      storeLocation: 'archivio locale',
      importFiles,
      clearAll: async () => undefined,
    };
  };

  it('le regioni esistono, vuote, prima che si tocchi qualcosa', () => {
    archivioFinto(async () => []);
    const vista = monta(<ImportPage onDone={() => undefined} />);

    // Vuote ma presenti: è la condizione perché l'annuncio successivo venga letto.
    expect(stato(vista.host)).toBe('');
    expect(allarme(vista.host)).toBe('');
    // E invisibili: il loro contenuto è la versione a parole di ciò che la pagina
    // già mostra, mostrarlo due volte allungherebbe la pagina per tutti.
    expect(vista.host.querySelector('[role="status"]')!.className).toContain('solo-lettori');
    expect(vista.host.querySelector('[role="alert"]')!.className).toContain('solo-lettori');
    // L'urgenza dichiarata esplicitamente, non lasciata all'implicito del ruolo.
    expect(vista.host.querySelector('[role="status"]')!.getAttribute('aria-live')).toBe('polite');
    expect(vista.host.querySelector('[role="alert"]')!.getAttribute('aria-live')).toBe('assertive');
    vista.smonta();
  });

  it('annuncia partenza ed esito con i numeri, non «import riuscito»', async () => {
    const { promessa, risolvi } = differita<ImportOutcome[]>();
    archivioFinto(() => promessa);
    const vista = monta(<ImportPage onDone={() => undefined} />);

    sganciaFile(vista.host, ['garmin.fit', 'shearwater.xml', 'vecchio.csv']);

    // È PARTITA: quanti file, mentre la lettura è ancora in corso.
    expect(stato(vista.host)).toBe('Lettura di 3 file avviata.');
    expect(vista.host.querySelector('.btn-primary')!.getAttribute('aria-busy')).toBe('true');
    expect(vista.host.querySelector('.btn-primary')!.textContent).toContain('Lettura in corso');

    await act(async () => {
      risolvi([
        esito({ fileName: 'garmin.fit', found: 8, added: 7, duplicates: 1 }),
        esito({ fileName: 'shearwater.xml', found: 9, added: 5, merged: 4 }),
        esito({ fileName: 'vecchio.csv', found: 5, duplicates: 5, warnings: ['niente profilo'] }),
      ]);
    });

    // È FINITA COSÌ: gli stessi numeri della tabella, in una frase.
    const detto = stato(vista.host);
    expect(detto).toContain('3 file su 3 letti');
    expect(detto).toContain('22 immersioni trovate');
    expect(detto).toContain('12 nuove');
    expect(detto).toContain('4 arricchite');
    expect(detto).toContain('6 già presenti');
    expect(detto).toContain('1 avviso');
    // Nessun fallimento, nessun allarme: l'assertivo si tace quando va bene.
    expect(allarme(vista.host)).toBe('');
    // Il pulsante non è più occupato.
    expect(vista.host.querySelector('.btn-primary')!.getAttribute('aria-busy')).toBe('false');

    // La tabella dell'esito NON sta dentro una regione live: quaranta numeri
    // letti a voce di fila non sono un annuncio, sono una punizione. La frase
    // sopra è il riassunto, la tabella si esplora quando si vuole.
    expect(vista.host.querySelector('table')!.closest('[aria-live]')).toBeNull();
    vista.smonta();
  });

  it('un file illeggibile fra tanti finisce nell’allarme, con nome e motivo', async () => {
    const { promessa, risolvi } = differita<ImportOutcome[]>();
    archivioFinto(() => promessa);
    const vista = monta(<ImportPage onDone={() => undefined} />);

    sganciaFile(vista.host, ['buono.uddf', 'rotto.xml']);
    await act(async () => {
      risolvi([
        esito({ fileName: 'buono.uddf', found: 3, added: 3 }),
        esito({ fileName: 'rotto.xml', ok: false, error: 'formato non riconosciuto' }),
      ]);
    });

    // Quello che è entrato si racconta con calma…
    expect(stato(vista.host)).toContain('1 file su 2 letti');
    // …quello che non è entrato interrompe, con il nome del file e il perché:
    // senza il nome, chi ha trascinato sei file non sa quale rimettere in coda.
    expect(allarme(vista.host)).toBe('1 file su 2 non letti: rotto.xml (formato non riconosciuto).');
    vista.smonta();
  });

  it('quando cade tutto l’import lo dice l’allarme, e la voce tranquilla tace', async () => {
    const { promessa, rifiuta } = differita<ImportOutcome[]>();
    archivioFinto(() => promessa);
    const vista = monta(<ImportPage onDone={() => undefined} />);

    sganciaFile(vista.host, ['garmin.fit']);
    expect(stato(vista.host)).toContain('avviata');

    await act(async () => {
      rifiuta(new Error('spazio esaurito nell’archivio locale'));
    });

    // Prima di questa aggiunta la promessa rifiutata usciva da `void handle(...)`
    // e la pagina tornava com'era: nessun esito, nessuna spiegazione, per nessuno.
    expect(allarme(vista.host)).toBe('Import fallito: spazio esaurito nell’archivio locale');
    // Il «lettura avviata» non resta appeso: sarebbe diventato falso.
    expect(stato(vista.host)).toBe('');
    expect(vista.host.querySelector('.btn-primary')!.getAttribute('aria-busy')).toBe('false');
    vista.smonta();
  });

  it('anche l’azzeramento dell’archivio annuncia i tre momenti', async () => {
    const { promessa, risolvi } = differita<void>();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    finto.valore = {
      dives: Array.from({ length: 128 }, () => ({})),
      storeLocation: 'archivio locale',
      importFiles: async () => [],
      clearAll: () => promessa,
    };
    const vista = monta(<ImportPage onDone={() => undefined} />);

    const bottone = premi(vista.host, 'Cancella tutto');
    expect(stato(vista.host)).toBe('Cancellazione di 128 immersioni in corso…');
    expect(bottone.getAttribute('aria-busy')).toBe('true');
    expect(bottone.textContent).toContain('Cancellazione in corso');

    await act(async () => {
      risolvi();
    });
    // L'esito visivo è la sparizione di mezza pagina: nulla che una voce possa
    // raccontare da sé, quindi lo si dice — con quante ne sono state cancellate.
    expect(stato(vista.host)).toContain('Archivio azzerato: 128 immersioni cancellate');
    expect(bottone.getAttribute('aria-busy')).toBe('false');
    vista.smonta();
  });
});

// ---------------------------------------------------------------------------
// Analisi con Claude
// ---------------------------------------------------------------------------

describe('annunci dell’analisi con Claude', () => {
  const analisi = (over: Partial<StoredAnalysis> = {}): StoredAnalysis => ({
    kind: 'plan',
    subject: '-',
    text: 'Consumo in calo, assetto da sistemare nei primi cinque minuti di fondo.',
    model: 'claude-x-1',
    at: '2026-08-18T10:00:00Z',
    inputTokens: 8210,
    outputTokens: 1190,
    fingerprint: 'x',
    ...over,
  });

  const archivioFinto = (runAnalysis: () => Promise<StoredAnalysis>) => {
    finto.valore = {
      aiCredentials: { apiKey: 'chiave', model: 'claude-x-1' },
      analysis: () => undefined,
      runAnalysis,
      clearAnalysis: async () => undefined,
    };
  };

  const carta = () => (
    <AnalysisCard kind="plan" title="Rilettura del piano" description="Mette in ordine i risultati." />
  );

  it('annuncia la partenza col modello e l’esito con parole e token', async () => {
    const { promessa, risolvi } = differita<StoredAnalysis>();
    archivioFinto(() => promessa);
    const vista = monta(carta());

    expect(stato(vista.host)).toBe('');
    const bottone = premi(vista.host, 'Analizza con Claude');

    // È PARTITA. Mezzo minuto di attesa muta era il caso peggiore di tutta
    // l'applicazione: qui si dice che la richiesta è andata, e a quale modello.
    expect(stato(vista.host)).toContain('richiesta inviata al modello claude-x-1');
    expect(stato(vista.host)).toContain('qualche decina di secondi');
    expect(bottone.getAttribute('aria-busy')).toBe('true');
    expect(bottone.textContent).toContain('Analisi in corso');

    await act(async () => {
      risolvi(analisi({ text: 'una due tre quattro cinque sei' }));
    });

    // È FINITA COSÌ: quanto è lunga e quanto è costata — i due numeri che la
    // carta mostra sotto il testo, e gli unici che dicono se vale la pena
    // mettersi a leggerla.
    const detto = stato(vista.host);
    expect(detto).toContain('analisi pronta, 6 parole');
    // Passa da `int` e non da una costante scritta a mano: in italiano i numeri
    // di quattro cifre non prendono il punto — 8210 resta «8210», 18210 diventa
    // «18.210» — e una stringa fissa qui si romperebbe al primo cambio di soglia.
    expect(detto).toContain(`${int(8210)} token in ingresso e ${int(1190)} in uscita`);
    expect(bottone.getAttribute('aria-busy')).toBe('false');
    vista.smonta();
  });

  it('il fallimento passa dall’allarme e viene detto UNA volta sola', async () => {
    const { promessa, rifiuta } = differita<StoredAnalysis>();
    archivioFinto(() => promessa);
    const vista = monta(carta());

    // La regione assertiva c'è già, vuota, prima che l'errore esista.
    expect(vista.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(allarme(vista.host)).toBe('');

    premi(vista.host, 'Analizza con Claude');
    await act(async () => {
      rifiuta(new Error('credito esaurito sull’account Anthropic'));
    });

    expect(allarme(vista.host)).toBe('credito esaurito sull’account Anthropic');
    // Il messaggio visibile È il contenuto della regione, non una seconda copia
    // nascosta accanto: altrimenti lo screen reader lo leggerebbe due volte.
    const paragrafo = vista.host.querySelector('[role="alert"] p');
    expect(paragrafo).not.toBeNull();
    const quante = (vista.host.textContent ?? '').split('credito esaurito').length - 1;
    expect(quante, 'il motivo dell’errore compare più di una volta').toBe(1);
    // E il «richiesta inviata» non resta appeso a dire il falso.
    expect(stato(vista.host)).toBe('');
    vista.smonta();
  });

  it('anche la rimozione dell’analisi salvata si annuncia', async () => {
    const { promessa, risolvi } = differita<void>();
    finto.valore = {
      aiCredentials: { apiKey: 'chiave', model: 'claude-x-1' },
      analysis: () => analisi(),
      runAnalysis: async () => analisi(),
      clearAnalysis: () => promessa,
    };
    const vista = monta(carta());

    premi(vista.host, 'Rimuovi');
    expect(stato(vista.host)).toContain("rimozione dell'analisi salvata");
    await act(async () => {
      risolvi();
    });
    expect(stato(vista.host)).toContain("analisi rimossa dall'archivio locale");
    vista.smonta();
  });
});

// ---------------------------------------------------------------------------
// Piano di miglioramento
// ---------------------------------------------------------------------------

/** Un archivio sintetico appena sufficiente a far parlare `buildPlan`. */
function archivio(n: number): Dive[] {
  const GIORNO = 86_400_000;
  const ora = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const inizio = new Date(ora - (5 + (n - 1 - i) * 10) * GIORNO);
    const samples: Sample[] = Array.from({ length: 240 }, (_, k) => ({
      t: k * 10,
      depth: Math.max(0, 28 - Math.abs(120 - k) * 0.22),
      tempC: 17,
      pressureBar: [200 - k * 0.5],
    }));
    const dive: Dive = {
      id: `p${i}`,
      number: i + 1,
      startTime: inizio.toISOString(),
      durationS: 2400,
      maxDepth: 28,
      minTempC: 17,
      site: { name: 'Punta Chiappa' },
      mode: 'oc',
      cylinders: [{ mix: AIR, sizeL: 12, startBar: 200, endBar: 80 }],
      salinity: 'salt',
      source: { format: 'uddf', file: 'sintetico', importedAt: inizio.toISOString() },
      tags: [],
      samples,
    };
    dive.metrics = computeMetrics(dive);
    return dive;
  });
}

describe('annunci del piano di miglioramento', () => {
  const dives = archivio(24);
  const agg = aggregate(dives);

  const archivioFinto = (goalId: string, piano: Plan, quante = dives.length) => {
    const finestra = dives.slice(dives.length - quante);
    finto.valore = {
      dives,
      aggregates: agg,
      plan: piano,
      goalId,
      setGoalId: () => undefined,
      period: '12m',
      setPeriod: () => undefined,
      scope: {
        period: periodOf('12m'),
        dives: finestra,
        excluded: dives.length - finestra.length,
        from: finestra[0]?.startTime,
        to: finestra[finestra.length - 1]?.startTime,
      },
      // La carta dell'analisi vive dentro questa pagina: senza chiave resta
      // spenta, che è quello che serve qui.
      aiCredentials: null,
      analysis: () => undefined,
      runAnalysis: async () => undefined,
      clearAnalysis: async () => undefined,
    };
  };

  it('all’apertura della scheda non annuncia niente', () => {
    archivioFinto('general', buildPlan(dives, agg, 'general'));
    const vista = monta(<Coach />);
    // La regione c'è — deve esistere prima — ma tace: il piano non è «cambiato»,
    // è arrivato insieme al titolo, e chi legge sta già scorrendo la pagina.
    expect(vista.host.querySelector('[role="status"]')).not.toBeNull();
    expect(stato(vista.host)).toBe('');
    vista.smonta();
  });

  it('cambiando obiettivo dice i numeri nuovi del piano', () => {
    archivioFinto('general', buildPlan(dives, agg, 'general'));
    const vista = monta(<Coach />);

    const tec = buildPlan(dives, agg, 'tec');
    archivioFinto('tec', tec);
    vista.aggiorna(<Coach />);

    const detto = stato(vista.host);
    expect(detto).toContain(`Piano ricalcolato per l'obiettivo «${tec.readiness.goal.label}»`);
    // I numeri che sono la ragione stessa per cui si cambia obiettivo: senza,
    // resterebbe da ripercorrere tutta la pagina per sapere com'è andata.
    expect(detto).toContain(`prontezza ${Math.round(tec.readiness.score * 100)}%`);
    expect(detto).toContain(
      `${tec.readiness.items.filter((i) => i.met).length} criteri su ${tec.readiness.items.length} soddisfatti`,
    );
    expect(detto).toContain(`${tec.focus.length} priorità su cui lavorare adesso`);
    expect(detto).toContain(`${tec.strengths.length} punti di forza`);
    expect(detto).toContain('24 immersioni del periodo «Ultimi 12 mesi»');
    vista.smonta();
  });

  it('stringendo la finestra sotto le tre immersioni lo dice invece di ammutolire', () => {
    archivioFinto('general', buildPlan(dives, agg, 'general'));
    const vista = monta(<Coach />);

    // Stessa pagina, altro ramo: sparisce tutto il piano e resta un cartello.
    // L'annuncio sopravvive al cambio di ramo perché il componente sta nella
    // stessa posizione in entrambi — se venisse rimontato, il testo si
    // perderebbe proprio nel momento in cui serve.
    archivioFinto('general', buildPlan(dives, agg, 'general'), 2);
    vista.aggiorna(<Coach />);

    const detto = stato(vista.host);
    expect(detto).toContain('Piano non calcolabile');
    expect(detto).toContain('2 immersioni');
    expect(detto).toContain("24 in tutto l'archivio");
    expect(detto).toContain('almeno 3');
    vista.smonta();
  });
});
