/**
 * Il numero progressivo dell'immersione.
 *
 * PERCHÉ QUESTO FILE ESISTE. Il 24 agosto 2026 due immersioni scaricate via
 * Bluetooth sono comparse nel logbook con un trattino al posto del numero,
 * accanto a centoquattro righe numerate. La causa non era il Bluetooth: il
 * progressivo veniva assegnato dentro il lettore di LogTRAK, contando le
 * immersioni DI QUEL FILE. Esisteva per un accidente — l'archivio era nato da
 * un unico file letto tutto insieme.
 *
 * Il trattino era il sintomo gentile. Quello cattivo stava dall'altra parte:
 * importando un secondo file, le sue immersioni prendevano i numeri da 1 in
 * su, sopra a quelli già in archivio. Due immersioni con lo stesso numero sono
 * peggio di nessun numero, perché il numero è ciò con cui un subacqueo cita la
 * propria immersione a qualcun altro.
 */

import { describe, expect, it } from 'vitest';
import { conNumeri, numeriProgressivi, scartoDiNumerazione } from '../src/core/numerazione';
import type { Dive } from '../src/core/model';

function imm(id: string, startTime: string, extra: Partial<Dive> = {}): Dive {
  return {
    id,
    startTime,
    durationS: 2400,
    maxDepth: 20,
    mode: 'oc',
    cylinders: [],
    source: { kind: 'ble', format: 'uwatec-ble' },
    tags: [],
    ...extra,
  } as unknown as Dive;
}

describe('il numero è la posizione nel logbook', () => {
  it('conta dalla più vecchia, qualunque sia l’ordine in cui arrivano', () => {
    // L'archivio in memoria è ordinato dalla più recente: il numero no.
    const numeri = numeriProgressivi([
      imm('c', '2026-08-24T07:24:00.000Z'),
      imm('a', '2020-06-13T08:35:00.000Z'),
      imm('b', '2026-07-11T08:24:00.000Z'),
    ]);
    expect(numeri.get('a')).toBe(1);
    expect(numeri.get('b')).toBe(2);
    expect(numeri.get('c')).toBe(3);
  });

  it('un’immersione scaricata dal computer un numero ce l’ha lo stesso', () => {
    /*
     * IL CASO VERO. Né il Peregrine né l'Aladin registrano un progressivo: nel
     * loro log c'è un indice interno di memoria, che si riusa. Prima restavano
     * senza numero; adesso il numero non dipende più da chi ha scritto il dato.
     */
    const archivio = Array.from({ length: 104 }, (_, i) =>
      imm(`vecchia${i}`, `2024-0${(i % 9) + 1}-0${(i % 9) + 1}T08:00:0${i % 10}.000Z`),
    );
    const nuove = [imm('ble1', '2026-08-24T05:46:00.000Z'), imm('ble2', '2026-08-24T07:24:00.000Z')];
    const numeri = numeriProgressivi([...archivio, ...nuove]);
    expect(numeri.get('ble1')).toBe(105);
    expect(numeri.get('ble2')).toBe(106);
  });

  it('un secondo import non rimette i numeri da 1: è il difetto che si chiude', () => {
    /*
     * Prima: le dieci immersioni del secondo file venivano numerate 1..10
     * dentro il lettore, e finivano in archivio accanto alle 1..104 già
     * presenti. Calcolando la posizione, i numeri sono quelli che devono
     * essere — e le vecchie non si spostano di un posto, perché le nuove sono
     * più recenti.
     */
    const primi = Array.from({ length: 5 }, (_, i) => imm(`p${i}`, `2024-01-0${i + 1}T08:00:00.000Z`));
    const secondi = Array.from({ length: 3 }, (_, i) => imm(`s${i}`, `2025-01-0${i + 1}T08:00:00.000Z`));
    const numeri = numeriProgressivi([...primi, ...secondi]);
    expect([...numeri.values()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(numeri.get('p0')).toBe(1);
    expect(numeri.get('s0')).toBe(6);
    // Nessun numero ripetuto: è la proprietà che prima non c'era.
    expect(new Set(numeri.values()).size).toBe(8);
  });

  it('un’immersione infilata in mezzo sposta le successive, non le precedenti', () => {
    // È quello che fa un logbook di carta quando ci si accorge di una pagina
    // saltata: da lì in poi si rinumera.
    const prima = numeriProgressivi([
      imm('a', '2024-01-01T08:00:00.000Z'),
      imm('c', '2024-03-01T08:00:00.000Z'),
    ]);
    expect(prima.get('c')).toBe(2);
    const dopo = numeriProgressivi([
      imm('a', '2024-01-01T08:00:00.000Z'),
      imm('b', '2024-02-01T08:00:00.000Z'),
      imm('c', '2024-03-01T08:00:00.000Z'),
    ]);
    expect(dopo.get('a')).toBe(1);
    expect(dopo.get('c')).toBe(3);
  });

  it('a parità di istante l’ordine è stabile, non quello di lettura', () => {
    /*
     * Due immersioni possono avere lo stesso istante di inizio — succede con i
     * dati scritti a mano, dove l'ora si mette al minuto. Senza un criterio di
     * spareggio il numero cambierebbe da un avvio all'altro sulla stessa
     * immersione, senza che nessuno abbia toccato niente.
     */
    const uno = numeriProgressivi([
      imm('zz', '2024-01-01T08:00:00.000Z'),
      imm('aa', '2024-01-01T08:00:00.000Z'),
    ]);
    const due = numeriProgressivi([
      imm('aa', '2024-01-01T08:00:00.000Z'),
      imm('zz', '2024-01-01T08:00:00.000Z'),
    ]);
    expect(uno.get('aa')).toBe(due.get('aa'));
    expect(uno.get('zz')).toBe(due.get('zz'));
  });

  it('chi ha un logbook di carta alle spalle parte da dove è arrivato', () => {
    const numeri = numeriProgressivi([imm('a', '2024-01-01T08:00:00.000Z')], 40);
    expect(numeri.get('a')).toBe(41);
  });

  it('sul foglio che consegni compare il TUO numero, non quello della fonte', () => {
    // Un'immersione importata da un altro logbook porta con sé il numero che
    // aveva là dentro: sull'uscita va sovrascritto, altrimenti il PDF che dai a
    // un istruttore cita un'immersione che nel tuo archivio non esiste.
    const dive = imm('a', '2024-01-01T08:00:00.000Z', { number: 977 } as Partial<Dive>);
    const numeri = numeriProgressivi([dive]);
    expect(conNumeri([dive], numeri)[0].number).toBe(1);
    // L'originale non viene toccato: la numerazione è una vista, non un dato.
    expect(dive.number).toBe(977);
  });
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * ► LE 148 CHE ERANO 183. ◄
 *
 * Segnalazione del 16 settembre 2026, dalla stessa persona che il giorno prima
 * aveva trovato il PDF che non c'era:
 *
 *   *«Dovresti inserire la possibilità di cambiare la numerazione delle
 *    immersioni. Ad esempio io ho scaricato dal mio computer 148 immersioni e
 *    l'ultima mi compare immersione #148 ma in realtà sarebbe la #183.»*
 *
 * Il motore sapeva già contare da un numero diverso da zero: `numeriProgressivi`
 * ha il parametro `precedenti` dal giorno in cui è nata, e la prova qui sopra —
 * «chi ha un logbook di carta alle spalle parte da dove è arrivato» — lo
 * misurava già. Quello che mancava era **il modo di dirglielo**: nessuna
 * casella nell'interfaccia, e il valore nessuno lo passava.
 *
 * *Una funzione giusta che nessuno può chiamare non è una funzione: è una
 * funzione in attesa.* È lo stesso difetto del gestore che registra un comando
 * non compilato, visto dall'altro capo.
 */
describe('lo scarto per chi ha un logbook di carta alle spalle', () => {
  it('il caso esatto della segnalazione: 148 scaricate, l’ultima è la 183', () => {
    const archivio = Array.from({ length: 148 }, (_, i) =>
      imm(`d${String(i).padStart(3, '0')}`, new Date(Date.UTC(2020, 0, 1 + i, 9)).toISOString()),
    );
    const numeri = numeriProgressivi(archivio, 35);
    expect(numeri.get('d000'), 'la prima registrata').toBe(36);
    expect(numeri.get('d147'), 'l’ultima registrata').toBe(183);
    // E il totale non cambia: lo scarto sposta i numeri, non aggiunge righe.
    expect(numeri.size).toBe(148);
  });

  it('senza scarto tutto resta com’era, e non è una formalità', () => {
    // Chi ha registrato tutto da sempre non deve accorgersi che questa
    // possibilità esiste. Il valore assente e il valore zero sono la stessa
    // cosa, e devono restarlo: `immersioniPrecedenti` è opzionale.
    const archivio = [imm('a', '2024-01-01T08:00:00.000Z'), imm('b', '2024-01-02T08:00:00.000Z')];
    expect([...numeriProgressivi(archivio).values()]).toEqual([1, 2]);
    expect([...numeriProgressivi(archivio, 0).values()]).toEqual([1, 2]);
    expect([...numeriProgressivi(archivio, undefined).values()]).toEqual([1, 2]);
  });
});

/*
 * ► IL VALORE ARRIVA DA UNA CASELLA, E UNA CASELLA SA DIRE DI TUTTO. ◄
 *
 * `NaN` quando la si svuota, un negativo quando scappa un meno, un decimale da
 * un incollaggio, un milione da una cifra tenuta premuta. Nessuno di questi è
 * un errore da segnalare — sono modi in cui una casella si comporta — ma tutti
 * e quattro, sommati a un indice, danno un numero d'immersione che non vuol
 * dire niente: `#NaN`, `#-1`, `#36.5`.
 *
 * La rete sta DENTRO `numeriProgressivi` e non al punto di immissione, perché
 * i punti di immissione si moltiplicano e quella funzione è una sola.
 */
describe('lo scarto si ripulisce da sé', () => {
  it.each([
    ['la casella svuotata', Number.NaN, 0],
    ['un meno scappato', -5, 0],
    ['un decimale incollato', 35.7, 35],
    ['un valore assente', undefined, 0],
    ['una cifra tenuta premuta', 9_999_999, 99_999],
    // Un infinito non è un tetto da applicare: non è un conteggio. Vale come
    // la casella vuota, che è la risposta onesta a «quante ne hai fatte».
    ['un infinito', Number.POSITIVE_INFINITY, 0],
    ['il caso normale', 35, 35],
  ])('%s → %s', (_caso, dato, atteso) => {
    expect(scartoDiNumerazione(dato as number | undefined)).toBe(atteso);
  });

  it('e nessun numero d’immersione può uscire NaN da qui', () => {
    // ► LA GUARDIA DELLA GUARDIA: se `scartoDiNumerazione` non venisse
    //   applicata dentro `numeriProgressivi`, questa riga darebbe `NaN` — e
    //   `NaN` su un numero che si scrive sul libretto a valore legale è
    //   peggio di un numero assente, perché sembra un guasto del programma
    //   invece che un dato da correggere.
    const numeri = numeriProgressivi([imm('a', '2024-01-01T08:00:00.000Z')], Number.NaN);
    expect(numeri.get('a')).toBe(1);
    expect(Number.isNaN(numeri.get('a'))).toBe(false);
  });
});
