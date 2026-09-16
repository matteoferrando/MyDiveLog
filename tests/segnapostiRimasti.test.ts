/**
 * NESSUN SEGNAPOSTO ARRIVA A SCHERMO, e uno ci è arrivato per davvero.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ► COS'È SUCCESSO, IL 16 SETTEMBRE 2026. ◄
 *
 * L'etichetta della fase delle soste con lo stage è diventata un MODELLO —
 * `'Soste con {0}'` — con il gas in un campo a parte, per toglierla dalle chiavi
 * costruite interpolando. Il modello è stato portato fino a `SchedulePoint`, che
 * è la tabella delle pressioni, e lì funzionava.
 *
 * **Ma chi disegna le FASI legge `label` e basta**, e sono due: la tabella delle
 * fasi del pianificatore e la sezione «Le fasi» del foglio che si stampa e si
 * porta sott'acqua. Su quel foglio si leggeva, alla lettera:
 *
 *     Soste con {0}   15 min   6 m   340
 *
 * *Un modello che gira per il codice senza il suo valore è una stringa rotta che
 * aspetta il primo che la disegni.*
 *
 * ► PERCHÉ NESSUNA PROVA SE N'È ACCORTA. ◄ `tests/gasPlan.test.ts` non legge mai
 * `planned[].label`; `tests/dizionario.test.ts` vede solo i `t('letterale')` e
 * `t(p.label)` gli è invisibile; `tests/testiTradotti.test.ts` guarda i canali a
 * variabile che conosce, e questo era nuovo. **Tre guardie, tre punti ciechi
 * diversi, e in mezzo ci passava una graffa.**
 *
 * ► LA REGOLA CHE QUESTA PROVA INCHIODA, e che non ha eccezioni. ◄ Un modello si
 * riconosce da fuori: contiene `{0}`. Quindi *qualunque* testo che arrivi a un
 * occhio umano e contenga ancora una graffa numerata è un difetto, comunque sia
 * nato. Non si verifica la forma che il difetto ha avuto stavolta: si verifica
 * la proprietà.
 */

import { describe, expect, it } from 'vitest';
import { planGas, pressureSchedule, type GasPlan } from '../src/core/analysis/gasPlan';
import { foglioDelPiano } from '../src/core/export/planSheet';
import { INGLESE } from '../src/ui/traduzioni';

/** Una graffa numerata rimasta dentro un testo. */
const SEGNAPOSTO = /\{\d+\}/;

function pianoTecnico(): GasPlan {
  return planGas({
    depthM: 40,
    bottomMin: 20,
    totalMin: 30,
    rmvLpm: 18,
    tankL: 12,
    startBar: 200,
    mix: { o2: 0.21 },
    decoMix: { o2: 0.5 },
    decoTankL: 7,
    mode: 'tec',
  } as never);
}

describe('i modelli non arrivano mai a schermo con la graffa dentro', () => {
  it('ogni etichetta di fase con un segnaposto porta il suo valore', () => {
    /*
     * Il campo non è facoltativo per caso: `phaseAt` lo riempie sempre dalla
     * miscela della fase, che ha già in mano. Questa riga pretende che chi
     * aggiunge un modello nuovo non si dimentichi di dargli un valore — che è
     * esattamente quello che è successo.
     */
    const piano = pianoTecnico();
    const modelli = piano.planned.filter((f) => SEGNAPOSTO.test(f.label));
    expect(modelli.length, 'nessuna fase è un modello: la prova non misura niente').toBeGreaterThan(0);
    for (const f of modelli) {
      expect(f.gasEtichetta, `la fase «${f.label}» è un modello senza valore`).toBeTruthy();
    }
  });

  it('il foglio che si porta sott’acqua non contiene graffe', () => {
    const piano = pianoTecnico();
    const foglio = foglioDelPiano({
      plan: piano,
      schedule: pressureSchedule(piano),
      // La curva serve solo a due righe di testo del foglio: qui interessa cosa
      // viene STAMPATO nelle tabelle, e ricalcolare i tessuti costerebbe secondi
      // per una riga che non si guarda.
      curve: { ndlAtMaxMin: 9, ndlAtAvgMin: 12, leavesCurveAtMin: 9, points: [] } as never,
      contingenze: [],
      mode: 'tec',
      gf: { low: 40, high: 85 },
    } as never);

    const celle: string[] = [];
    for (const sezione of foglio.sezioni) {
      if (sezione.titolo) celle.push(sezione.titolo);
      for (const riga of sezione.righe ?? []) for (const c of riga) celle.push(String(c));
      for (const c of sezione.colonne ?? []) celle.push(String(c));
    }
    expect(celle.length, 'il foglio è vuoto: la prova non misura niente').toBeGreaterThan(20);
    const rotte = celle.filter((c) => SEGNAPOSTO.test(c));
    expect(rotte, `sul foglio stampato è rimasto un modello: ${rotte.join(' · ')}`).toEqual([]);
  });

  it('la tabella delle pressioni non contiene graffe', () => {
    const piano = pianoTecnico();
    const rotte = pressureSchedule(piano)
      .map((p) => p.phase)
      .filter((f) => SEGNAPOSTO.test(f) && !pressureSchedule(piano).some((x) => x.gasEtichetta));
    expect(rotte).toEqual([]);
    // E il valore c'è su ogni punto, che è la condizione perché chi disegna
    // possa ricomporre il modello.
    for (const p of pressureSchedule(piano)) {
      if (SEGNAPOSTO.test(p.phase)) expect(p.gasEtichetta, p.phase).toBeTruthy();
    }
  });

  it('nel dizionario l’inglese ha gli stessi segnaposti dell’italiano', () => {
    /*
     * L'altra metà: un modello tradotto perdendo un `{1}` stampa una frase
     * monca, e nessuno se ne accorge finché non si guarda l'app in inglese.
     * Costa un giro su duemila voci e chiude la strada per sempre.
     */
    const storte: string[] = [];
    for (const [it, en] of Object.entries(INGLESE)) {
      const a = (it.match(/\{\d+\}/g) ?? []).sort().join(',');
      const b = (en.match(/\{\d+\}/g) ?? []).sort().join(',');
      if (a !== b) storte.push(`«${it}» ha ${a || 'nessuno'}, «${en}» ha ${b || 'nessuno'}`);
    }
    expect(storte).toEqual([]);
  });
});
