/**
 * Attrezzatura e scadenze.
 *
 * L'aritmetica delle date è l'unica cosa da verificare qui, ed è anche l'unica in
 * cui si sbaglia: sommare mesi a una data è la funzione che tutti scrivono male.
 */

import { describe, expect, it } from 'vitest';
import { addMonths, checkGear, gearChecks, gearSummary, type GearItem } from '../src/core/analysis/gear';

const NOW = Date.parse('2026-08-17T12:00:00Z');
const item = (over: Partial<GearItem>): GearItem => ({
  id: 'x',
  kind: 'cylinder',
  name: 'D12',
  ...over,
});

describe('somma di mesi a una data', () => {
  it('caso normale', () => {
    expect(addMonths('2026-03-15', 12)).toBe('2027-03-15');
    expect(addMonths('2026-03-15', 24)).toBe('2028-03-15');
  });

  it('fine mese: il 31 gennaio più un mese è febbraio, non marzo', () => {
    // È l'errore classico di `setMonth`: normalizza il 31 febbraio al 3 marzo, e
    // una scadenza di fine mese slitta di qualche giorno a ogni rinnovo.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-05-31', 1)).toBe('2026-06-30');
  });

  it('attraversa l’anno', () => {
    expect(addMonths('2026-11-20', 3)).toBe('2027-02-20');
  });
});

describe('stato di un pezzo', () => {
  it('calcola la scadenza dall’ultima revisione e dall’intervallo', () => {
    const c = checkGear(item({ lastServiceDate: '2025-09-01', intervalMonths: 24 }), NOW);
    expect(c.dueDate).toBe('2027-09-01');
    expect(c.status).toBe('ok');
    expect(c.daysLeft).toBeGreaterThan(300);
  });

  it('riconosce le scadenze imminenti e quelle passate', () => {
    expect(checkGear(item({ expiresOn: '2026-09-30' }), NOW).status).toBe('due');
    expect(checkGear(item({ expiresOn: '2026-07-01' }), NOW).status).toBe('expired');
    expect(checkGear(item({ expiresOn: '2027-06-01' }), NOW).status).toBe('ok');
  });

  it('una scadenza esplicita vince sull’intervallo', () => {
    const c = checkGear(
      item({ lastServiceDate: '2020-01-01', intervalMonths: 12, expiresOn: '2027-01-01' }),
      NOW,
    );
    expect(c.dueDate).toBe('2027-01-01');
  });

  it('senza date non inventa niente', () => {
    const c = checkGear(item({}), NOW);
    expect(c.status).toBe('unknown');
    expect(c.dueDate).toBeUndefined();
  });
});

describe('elenco e riepilogo', () => {
  const items = [
    item({ id: '1', name: 'Erogatore', kind: 'regulator', expiresOn: '2027-01-01' }),
    item({ id: '2', name: 'Bombola scaduta', expiresOn: '2026-05-01' }),
    item({ id: '3', name: 'Medico', kind: 'medical', expiresOn: '2026-09-10' }),
    item({ id: '4', name: 'Muta', kind: 'suit' }),
  ];

  it('mette in cima ciò che è scaduto, poi ciò che sta per scadere', () => {
    const order = gearChecks(items, NOW).map((c) => c.item.id);
    expect(order).toEqual(['2', '3', '1', '4']);
  });

  it('i pezzi senza scadenza restano in elenco', () => {
    // Un pezzo di cui non si sa niente non è un pezzo a posto.
    const checks = gearChecks(items, NOW);
    expect(checks[checks.length - 1].status).toBe('unknown');
  });

  it('il riepilogo conta le tre categorie e indica la prossima', () => {
    const s = gearSummary(items, NOW);
    expect(s.expired).toBe(1);
    expect(s.due).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.next?.item.id).toBe('2');
  });
});
