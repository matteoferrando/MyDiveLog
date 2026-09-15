/**
 * Cancellare una muta, un brevetto o un piano, e trovarli cancellati anche
 * domani.
 *
 * ► IL DIFETTO, MISURATO. ◄ Attrezzatura, brevetti e piani salvati con un nome
 * si fondono per chiave, e una fusione per chiave non sa cosa sia una
 * cancellazione: la chiave che il locale non ha più e il remoto sì veniva
 * riaggiunta **e riscritta in locale**. Misurato su due archivi allineati: si
 * cancella un attrezzo, si sincronizza, e l'elenco torna di due — su tutti e due
 * i dispositivi. Il rapporto della sincronizzazione annunciava pure un
 * arricchimento mentre disfaceva una cancellazione.
 *
 * La correzione non aggiunge niente alla sincronizzazione: **la cancellazione è
 * già una scrittura come le altre**, e vince per data come vincerebbe una
 * modifica. Il perché della scelta sta in testa a `core/lapidiPerChiave.ts`.
 *
 * L'ultima prova di questo file non guarda la logica ma il **cablaggio**: una
 * lapide perfetta che nessuno mette è esattamente il difetto di partenza.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { conLapidi, soloVive } from '../src/core/lapidiPerChiave';
import { mergeKeyed } from '../src/sync/turso';

interface Attrezzo {
  id: string;
  name: string;
  savedAt?: string;
  cancellataIl?: string;
}

const MUTA: Attrezzo = { id: 'e1', name: 'muta 7mm', savedAt: '2026-05-01T10:00:00Z' };
const GAV: Attrezzo = { id: 'e2', name: 'gav', savedAt: '2026-05-01T10:00:00Z' };
const chiave = (a: Attrezzo) => a.id;

describe('una voce cancellata', () => {
  it('lascia una lapide con una data fresca, non sparisce e basta', () => {
    const dopo = conLapidi([MUTA, GAV], [MUTA], chiave, '2026-06-01T12:00:00Z');
    expect(soloVive(dopo).map((a) => a.id)).toEqual(['e1']);
    const lapide = dopo.find((a) => a.id === 'e2');
    expect(lapide?.cancellataIl).toBe('2026-06-01T12:00:00Z');
    // La data che la fusione confronta va rifatta, o la lapide perderebbe
    // contro la copia viva dell'altro dispositivo: cioè non cancellerebbe.
    expect(lapide?.savedAt).toBe('2026-06-01T12:00:00Z');
  });

  it('non riordina quello che è rimasto vivo', () => {
    const dopo = conLapidi([MUTA, GAV], [GAV, MUTA], chiave, '2026-06-01T12:00:00Z');
    expect(dopo.slice(0, 2).map((a) => a.id)).toEqual(['e2', 'e1']);
  });

  it('e le lapidi vecchie restano dove sono', () => {
    const conVecchia = [
      MUTA,
      { ...GAV, cancellataIl: '2026-05-20T09:00:00Z', savedAt: '2026-05-20T09:00:00Z' },
    ];
    const dopo = conLapidi(conVecchia, [MUTA], chiave, '2026-06-01T12:00:00Z');
    expect(dopo.filter((a) => a.cancellataIl)).toHaveLength(1);
    expect(dopo.find((a) => a.id === 'e2')?.cancellataIl).toBe('2026-05-20T09:00:00Z');
  });
});

describe('fra due dispositivi', () => {
  /** Un giro di sincronizzazione: i due si fondono per chiave, come nel vero. */
  const unGiro = (a: Attrezzo[], b: Attrezzo[]) => {
    const versoA = mergeKeyed(a, b, 'id').value as Attrezzo[];
    const versoB = mergeKeyed(b, a, 'id').value as Attrezzo[];
    return [versoA, versoB] as const;
  };

  it('la cancellazione arriva all’altro invece di essere disfatta dall’altro', () => {
    const cancella = conLapidi([MUTA, GAV], [MUTA], chiave, '2026-06-01T12:00:00Z');
    let [a, b] = unGiro(cancella, [MUTA, GAV]);
    expect(soloVive(a).map((x) => x.id)).toEqual(['e1']);
    expect(soloVive(b).map((x) => x.id)).toEqual(['e1']);
    // E resta cancellata: il difetto vero non era perderla una volta, era
    // vederla tornare a ogni giro.
    for (let giro = 0; giro < 3; giro++) [a, b] = unGiro(a, b);
    expect(soloVive(a).map((x) => x.id)).toEqual(['e1']);
    expect(soloVive(b).map((x) => x.id)).toEqual(['e1']);
  });

  it('mentre chi la ricrea dopo vince, perché è una scrittura più recente', () => {
    const cancellata = conLapidi([MUTA, GAV], [MUTA], chiave, '2026-06-01T12:00:00Z');
    const ricreata = [MUTA, { ...GAV, name: 'gav nuovo', savedAt: '2026-06-02T08:00:00Z' }];
    const [a] = unGiro(cancellata, ricreata);
    expect(soloVive(a).map((x) => x.name)).toEqual(['muta 7mm', 'gav nuovo']);
  });
});

describe('il cablaggio', () => {
  /*
   * Una lapide che nessuno mette non cancella niente, e la prova qui sopra
   * resterebbe verde lo stesso: è il difetto di partenza, spostato di un file.
   */
  const sorgente = readFileSync('src/ui/state.tsx', 'utf8');

  it('l’attrezzatura salvata passa dalle lapidi', () => {
    const dentroSaveGear = sorgente.slice(
      sorgente.indexOf('const saveGear = useCallback'),
      sorgente.indexOf('const saveSubacqueo'),
    );
    expect(dentroSaveGear).toContain('conLapidi(');
    // Due raccolte, due chiamate: attrezzi e brevetti.
    expect(dentroSaveGear.match(/conLapidi\(/g) ?? []).toHaveLength(2);
  });

  it('il piano cancellato passa dalle lapidi invece di essere filtrato via', () => {
    const dentro = sorgente.slice(
      sorgente.indexOf('const deleteNamedDecoPlan = useCallback'),
      sorgente.indexOf('const saveSyncCredentials'),
    );
    expect(dentro).toContain('conLapidi(');
  });

  it('e l’interfaccia riceve solo le voci vive', () => {
    expect(sorgente).toMatch(/gear:\s*gearVive/);
    expect(sorgente).toMatch(/decoPlans:\s*decoPlansVivi/);
  });
});
