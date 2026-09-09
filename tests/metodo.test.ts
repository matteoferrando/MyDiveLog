/**
 * Il metodo di collegamento conservato: cosa si ricorda e cosa no.
 *
 * La regola è la stessa dell'accoppiamento: **una chiave a metà è peggio di
 * nessuna chiave**. Nessuna chiave fa ricominciare il giro dal primo modo, che
 * funziona sempre; una chiave storta manderebbe il guscio a cercare una
 * combinazione che non esiste, e la riga di diario direbbe una cosa che non è
 * mai successa.
 */

import { describe, expect, it } from 'vitest';
import { dimenticaMetodo, metodoConservato, salvaMetodo } from '../src/core/metodo';

function archivio(iniziale: Record<string, string> = {}): Storage & { dentro: Record<string, string> } {
  const dentro: Record<string, string> = { ...iniziale };
  return {
    dentro,
    length: 0,
    clear: () => {
      for (const k of Object.keys(dentro)) delete dentro[k];
    },
    getItem: (k: string) => (k in dentro ? dentro[k] : null),
    key: () => null,
    removeItem: (k: string) => {
      delete dentro[k];
    },
    setItem: (k: string, v: string) => {
      dentro[k] = v;
    },
  };
}

const BUONA = 'fe25c237-0ece-443c-b0aa-e02033e7029d|11111111|22222222|senza|unite';

describe('il metodo conservato', () => {
  it('va e torna, sotto una chiave che porta il nome del dispositivo', () => {
    const dove = archivio();
    salvaMetodo('dev-1', BUONA, dove);
    expect(metodoConservato('dev-1', dove)).toBe(BUONA);
    // Due computer diversi non si scambiano il metodo: sarebbe una
    // combinazione valida presentata all'apparecchio sbagliato.
    expect(metodoConservato('dev-2', dove)).toBeUndefined();
    expect(Object.keys(dove.dentro)).toEqual(['mydivelog.metodo.dev-1']);
  });

  it('rifiuta quello che non ha la forma di una chiave, in scrittura e in lettura', () => {
    const dove = archivio();
    for (const brutta of ['', '   ', 'a|b|c|d', 'a|b|c|d|e|f', 'a||c|d|e', '|b|c|d|e']) {
      salvaMetodo('dev-1', brutta, dove);
      expect(dove.dentro['mydivelog.metodo.dev-1'], brutta).toBeUndefined();
    }
    // E se ce la ritrovassimo dentro — scritta da una versione più vecchia —
    // leggerla deve dare «non ce l'ho», non restituirla a metà.
    const sporco = archivio({ 'mydivelog.metodo.dev-1': 'due|pezzi' });
    expect(metodoConservato('dev-1', sporco)).toBeUndefined();
  });

  it('non controlla il SIGNIFICATO dei pezzi, e non deve', () => {
    /*
     * Cosa voglia dire ogni pezzo lo sa il guscio Rust, ed è lui a dover dire
     * «questo metodo non è più fra quelli possibili». Controllarlo anche qui
     * vorrebbe dire tenere in due posti una regola che cambia in uno solo — e
     * il giorno che il Rust aggiungesse una politica nuova, questa riga
     * comincerebbe a buttare via chiavi buone senza che nessuno lo colleghi
     * alla modifica.
     */
    const dove = archivio();
    salvaMetodo('dev-1', 'non-un-uuid|nemmeno|questo|boh|mah', dove);
    expect(metodoConservato('dev-1', dove)).toBe('non-un-uuid|nemmeno|questo|boh|mah');
  });

  it('si dimentica, per quando smette di funzionare', () => {
    const dove = archivio();
    salvaMetodo('dev-1', BUONA, dove);
    dimenticaMetodo('dev-1', dove);
    expect(metodoConservato('dev-1', dove)).toBeUndefined();
  });

  it('un dispositivo senza nome non ha una chiave', () => {
    const dove = archivio();
    salvaMetodo('', BUONA, dove);
    expect(Object.keys(dove.dentro)).toEqual([]);
    expect(metodoConservato('', dove)).toBeUndefined();
  });

  it('un archivio che si rifiuta non fa fallire niente', () => {
    const no = () => {
      throw new Error('i dati dei siti sono bloccati');
    };
    const rotto: Storage = { length: 0, clear: no, getItem: no, key: no, removeItem: no, setItem: no };
    expect(() => salvaMetodo('dev-1', BUONA, rotto)).not.toThrow();
    expect(metodoConservato('dev-1', rotto)).toBeUndefined();
    expect(() => dimenticaMetodo('dev-1', rotto)).not.toThrow();
  });
});
