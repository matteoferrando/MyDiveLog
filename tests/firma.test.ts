/**
 * La firma della guida: la lettera o) del libretto.
 *
 * Quello che si può provare senza un dito su uno schermo è tutto il contorno, e
 * il contorno è dove stanno gli sbagli: che un tocco solo non passi per una
 * firma, che i punti non gonfino il record, che i numeri non finiscano nella
 * pagina stampata con diciassette decimali, e che il disegno si riscali senza
 * deformare la grafia di nessuno.
 */

import { describe, expect, it } from 'vitest';
import { descriviFirma, firmaPath, firmaVuota, semplifica, type FirmaGuida } from '../src/core/firma';
import { libretto } from '../src/core/libretto';
import type { Dive } from '../src/core/model';

const FIRMA: FirmaGuida = {
  tratti: [
    [
      { x: 10, y: 100 },
      { x: 50, y: 40 },
      { x: 90, y: 120 },
    ],
    [
      { x: 120, y: 60 },
      { x: 200, y: 60 },
    ],
  ],
  larghezza: 600,
  altezza: 200,
  quando: '2026-07-11T10:30:00Z',
  nome: 'Anna Bianchi',
};

describe('quando una firma è una firma', () => {
  it('un tocco solo non lo è', () => {
    // Sfiorare il riquadro per sbaglio non deve produrre una firma valida, e
    // soprattutto non deve far comparire la lettera o) come soddisfatta.
    expect(firmaVuota(undefined)).toBe(true);
    expect(firmaVuota({ ...FIRMA, tratti: [] })).toBe(true);
    expect(firmaVuota({ ...FIRMA, tratti: [[{ x: 1, y: 1 }]] })).toBe(true);
    expect(firmaVuota(FIRMA)).toBe(false);
  });
});

describe('la semplificazione dei tratti', () => {
  it('butta i punti che nessuno schermo distinguerebbe', () => {
    /*
     * Un dito produce centinaia di punti al secondo, quasi tutti a frazioni di
     * pixel l'uno dall'altro. Tenerli tutti gonfia il record — che poi passa
     * dalla sincronizzazione a ogni giro — e non cambia il disegno di un
     * capello.
     */
    const fitto = Array.from({ length: 100 }, (_, i) => ({ x: 10 + i * 0.05, y: 20 }));
    const magro = semplifica(fitto);
    expect(magro.length).toBeLessThan(fitto.length / 3);
    // Il primo e l'ultimo non si perdono mai: sono dove la penna appoggia e dove si stacca.
    expect(magro[0]).toEqual({ x: 10, y: 20 });
    // 10 + 99 x 0.05 = 14.95, arrotondato a un decimo.
    expect(magro[magro.length - 1].x).toBe(15);
  });

  it('un tratto di due punti resta di due punti', () => {
    expect(
      semplifica([
        { x: 1.04, y: 2 },
        { x: 9, y: 2 },
      ]),
    ).toEqual([
      { x: 1, y: 2 },
      { x: 9, y: 2 },
    ]);
  });
});

describe('il disegno', () => {
  it('alza la penna fra un tratto e l’altro', () => {
    // Due `M`: due volte in cui il dito si è staccato e riappoggiato.
    const d = firmaPath(FIRMA, 600, 200);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.startsWith('M10.0,100.0')).toBe(true);
  });

  it('non stampa mai numeri con diciassette decimali', () => {
    /*
     * `0.30000000000000004` moltiplicato per ogni punto finirebbe intero dentro
     * il documento da stampare. Una cifra dopo la virgola basta e avanza.
     */
    const d = firmaPath(FIRMA, 313, 104);
    for (const numero of d.match(/[\d.]+/g) ?? []) {
      expect(numero.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it('riscala con una scala sola, per non deformare la grafia', () => {
    // Metà larghezza e altezza intatta: si usa la scala più stretta delle due,
    // altrimenti la firma di qualcuno diventerebbe la firma di qualcun altro.
    const d = firmaPath(FIRMA, 300, 200);
    expect(d.startsWith('M5.0,50.0')).toBe(true);
  });
});

describe('la lettera o) del libretto', () => {
  const IMMERSIONE = {
    id: 'x',
    startTime: '2026-07-11T09:24:00Z',
    durationS: 3300,
    maxDepth: 31.2,
    mode: 'oc',
    cylinders: [{ mix: { o2: 0.21, he: 0 } }],
    source: { kind: 'manual' },
  } as unknown as Dive;

  it('senza firma resta vuota', () => {
    const o = libretto(IMMERSIONE, {}).find((v) => v.lettera === 'o');
    expect(o?.valore).toBeNull();
  });

  it('con la firma porta chi e quando, non un «sì»', () => {
    /*
     * La riga accompagna il segno, non lo sostituisce: chi mostra questa riga
     * deve mostrare anche i tratti, ed è quello che fa la stampa. Un «firmato:
     * sì» da solo sarebbe l'esatto contrario di quello che la lettera chiede.
     */
    const o = libretto({ ...IMMERSIONE, firmaGuida: FIRMA }, {}).find((v) => v.lettera === 'o');
    expect(o?.valore).toContain('Anna Bianchi');
    expect(o?.valore).toContain('11/07/2026');
  });

  it('un tocco per sbaglio non fa risultare firmata l’immersione', () => {
    const finta = { ...FIRMA, tratti: [[{ x: 3, y: 3 }]] };
    const o = libretto({ ...IMMERSIONE, firmaGuida: finta }, {}).find((v) => v.lettera === 'o');
    expect(o?.valore).toBeNull();
  });

  it('la descrizione passa dal dizionario', () => {
    const t = (frase: string) => (frase === 'firmato da' ? 'signed by' : frase === 'il' ? 'on' : frase);
    expect(descriviFirma(FIRMA, t)).toBe('signed by Anna Bianchi on 11/07/2026');
  });
});
