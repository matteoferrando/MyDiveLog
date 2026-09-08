/**
 * Il codice di accoppiamento: cosa si conserva, e soprattutto cosa non si
 * conserva.
 *
 * ► LA REGOLA CHE VALE TUTTO IL FILE. ◄ Un codice a metà è peggio di nessun
 * codice. Nessun codice fa ripartire dal PIN, che funziona sempre; un codice
 * sbagliato fa chiudere il collegamento al computer **senza dire perché**, e
 * il sintomo — «si connette e poi tace» — è indistinguibile da un guasto
 * Bluetooth. Per questo ogni controllo qui dentro, quando dubita, dice «non
 * ce l'ho».
 */

import { describe, expect, it } from 'vitest';
import {
  codiceAccoppiamento,
  dimenticaAccoppiamento,
  salvaCodiceAccoppiamento,
} from '../src/core/accoppiamento';

/** Un `localStorage` finto: è tutto quello che serve, e si ispeziona. */
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

/** Un archivio che si rifiuta: dati dei siti bloccati, spazio finito. */
function archivioRotto(): Storage {
  const no = () => {
    throw new Error('i dati dei siti sono bloccati');
  };
  return { length: 0, clear: no, getItem: no, key: no, removeItem: no, setItem: no };
}

const SEDICI = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';

describe('il codice di accoppiamento', () => {
  it('va e torna, sotto una chiave che porta il nome del dispositivo', () => {
    const dove = archivio();
    salvaCodiceAccoppiamento('dev-1', SEDICI, dove);
    expect(codiceAccoppiamento('dev-1', dove)).toBe(SEDICI);
    // Due computer diversi non si scambiano la chiave: sarebbe un codice
    // valido presentato all'apparecchio sbagliato.
    expect(codiceAccoppiamento('dev-2', dove)).toBeUndefined();
    expect(Object.keys(dove.dentro)).toEqual(['mydivelog.accoppiamento.dev-1']);
  });

  it('normalizza le maiuscole e gli spazi, perché è così che arrivano copiati a mano', () => {
    const dove = archivio();
    salvaCodiceAccoppiamento('dev-1', '  0A1B2C3D  ', dove);
    expect(codiceAccoppiamento('dev-1', dove)).toBe('0a1b2c3d');
  });

  it('rifiuta quello che non è esadecimale, in scrittura e in lettura', () => {
    const dove = archivio();
    for (const brutto of ['', '   ', '0a1b2', 'non-esadecimale', '0a1g', '0x0a1b']) {
      salvaCodiceAccoppiamento('dev-1', brutto, dove);
      expect(dove.dentro['mydivelog.accoppiamento.dev-1'], brutto).toBeUndefined();
    }
    // E anche se ce lo ritrovassimo dentro — scritto da una versione più
    // vecchia, o a mano — leggerlo deve dare «non ce l'ho».
    const sporco = archivio({ 'mydivelog.accoppiamento.dev-1': 'zzzz' });
    expect(codiceAccoppiamento('dev-1', sporco)).toBeUndefined();
    const dispari = archivio({ 'mydivelog.accoppiamento.dev-1': '0a1' });
    expect(codiceAccoppiamento('dev-1', dispari)).toBeUndefined();
  });

  it('non conserva un codice di tutti zeri', () => {
    /*
     * Tutti zeri è esattamente ciò che `pelagic_i330r_init` legge come «non
     * c'è»: conservarlo vorrebbe dire ripresentarlo a ogni scarico per poi
     * vederselo scartare, cioè pagare una scrittura e una lettura per niente.
     */
    const dove = archivio();
    salvaCodiceAccoppiamento('dev-1', '0'.repeat(32), dove);
    expect(codiceAccoppiamento('dev-1', dove)).toBeUndefined();
  });

  it('un dispositivo senza nome non ha una chiave', () => {
    // L'identificativo vuoto capita — un dispositivo visto male in scansione —
    // e scriverci sopra farebbe una chiave sola per tutti i computer.
    const dove = archivio();
    salvaCodiceAccoppiamento('', SEDICI, dove);
    expect(Object.keys(dove.dentro)).toEqual([]);
    expect(codiceAccoppiamento('', dove)).toBeUndefined();
  });

  it('si dimentica, per il giorno in cui il computer viene azzerato', () => {
    const dove = archivio();
    salvaCodiceAccoppiamento('dev-1', SEDICI, dove);
    dimenticaAccoppiamento('dev-1', dove);
    expect(codiceAccoppiamento('dev-1', dove)).toBeUndefined();
  });

  it('un archivio che si rifiuta non fa fallire niente', () => {
    /*
     * Alcuni browser lanciano al solo accesso quando i dati dei siti sono
     * bloccati. La conseguenza giusta è che il PIN venga richiesto ogni
     * volta: un fastidio da sei cifre. La conseguenza sbagliata sarebbe un
     * riquadro rosso a scarico riuscito.
     */
    const rotto = archivioRotto();
    expect(() => salvaCodiceAccoppiamento('dev-1', SEDICI, rotto)).not.toThrow();
    expect(codiceAccoppiamento('dev-1', rotto)).toBeUndefined();
    expect(() => dimenticaAccoppiamento('dev-1', rotto)).not.toThrow();
  });
});
