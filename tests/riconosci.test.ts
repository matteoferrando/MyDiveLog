/**
 * Dal nome Bluetooth al modello: le regole di `proponi`, viste rosse una per una.
 *
 * I candidati arrivano dal guscio Rust (`riconosci_computer_esterno`), che
 * interroga i filtri di libdivecomputer: sono per costruttore, e qui si
 * stringe sul modello con il catalogo. Le prove usano un catalogo finto per
 * poter costruire i casi limite, e una prova finale usa quello vero.
 */

import { describe, expect, it } from 'vitest';

import { MODELLI_BLE, type VoceCatalogo } from '../src/core/ble/catalogo';
import { proponi, type CandidatoRiconosciuto } from '../src/core/ble/riconosci';

const MARES: VoceCatalogo[] = [
  { marca: 'Mares', modello: 'Quad', famiglia: 'mares_iconhd', numeri: [41] },
  { marca: 'Mares', modello: 'Quad Ci', famiglia: 'mares_iconhd', numeri: [49] },
  { marca: 'Mares', modello: 'Quad Air', famiglia: 'mares_iconhd', numeri: [35] },
  { marca: 'Mares', modello: 'Puck Pro', famiglia: 'mares_iconhd', numeri: [24] },
  { marca: 'Mares', modello: 'Sirius', famiglia: 'mares_iconhd', numeri: [47] },
];
const OCEANIC: VoceCatalogo[] = [
  { marca: 'Aqualung', modello: 'i770R', famiglia: 'oceanic_atom2', numeri: [0x4651] },
  { marca: 'Aqualung', modello: 'i200C', famiglia: 'oceanic_atom2', numeri: [0x4649, 0x4749] },
  { marca: 'Oceanic', modello: 'Geo 4.0', famiglia: 'oceanic_atom2', numeri: [0x4653] },
];
const CRESSI: VoceCatalogo[] = [
  { marca: 'Cressi', modello: 'Goa', famiglia: 'cressi_goa', numeri: [2] },
  { marca: 'Cressi', modello: 'Leonardo 2.0', famiglia: 'cressi_goa', numeri: [3] },
];
const CATALOGO = [...MARES, ...OCEANIC, ...CRESSI];
const candidati = (voci: readonly VoceCatalogo[]): CandidatoRiconosciuto[] =>
  voci.map(({ marca, modello }) => ({ marca, modello }));

describe('dal nome Bluetooth al modello', () => {
  it('un candidato solo è il modello, qualunque sia il nome', () => {
    const p = proponi('EON Steel 123', [{ marca: 'Mares', modello: 'Sirius' }], CATALOGO);
    expect(p).toEqual({ tipo: 'modello', voce: MARES[4] });
  });

  it('il nome che contiene il modello vince, e fra più contenuti vince il più lungo', () => {
    // «Quad Ci» contiene «Quad» E «Quad Ci»: il più specifico è quello giusto.
    const p = proponi('Quad Ci', candidati(MARES), CATALOGO);
    expect(p).toEqual({ tipo: 'modello', voce: MARES[1] });
    // Maiuscole, trattini e numero di serie in coda non contano.
    expect(proponi('QUAD-CI 00123', candidati(MARES), CATALOGO)).toEqual({ tipo: 'modello', voce: MARES[1] });
    // «Quad» da solo è il Quad, non il Quad Ci.
    expect(proponi('Quad 4567', candidati(MARES), CATALOGO)).toEqual({ tipo: 'modello', voce: MARES[0] });
  });

  it('quando il nome dice solo la famiglia si propone la scelta fra i candidati', () => {
    // Il BlueLink Pro è un adattatore che si attacca a mezza gamma Mares.
    const p = proponi('Mares bluelink pro', candidati(MARES), CATALOGO);
    expect(p.tipo).toBe('scelta');
    if (p.tipo === 'scelta') expect(p.voci).toEqual(MARES);
  });

  it('oceanic e aqualung mettono il numero di modello nel nome, come due lettere', () => {
    // FQ = 0x4651 = i770R, FI = 0x4649 = i200C; GS = 0x4753 non esiste.
    expect(proponi('FQ001124', candidati(OCEANIC), CATALOGO)).toEqual({ tipo: 'modello', voce: OCEANIC[0] });
    expect(proponi('GI000001', candidati(OCEANIC), CATALOGO)).toEqual({ tipo: 'modello', voce: OCEANIC[1] });
    expect(proponi('GS000001', candidati(OCEANIC), CATALOGO).tipo).toBe('scelta');
  });

  it('cressi mette il numero di modello in esadecimale con un trattino basso', () => {
    expect(proponi('2_abc', candidati(CRESSI), CATALOGO)).toEqual({ tipo: 'modello', voce: CRESSI[0] });
    expect(proponi('3_abc', candidati(CRESSI), CATALOGO)).toEqual({ tipo: 'modello', voce: CRESSI[1] });
    expect(proponi('9_abc', candidati(CRESSI), CATALOGO).tipo).toBe('scelta');
  });

  it('senza candidati, senza nome o con candidati fuori catalogo non si propone niente', () => {
    expect(proponi('Quad Ci', [], CATALOGO)).toEqual({ tipo: 'niente' });
    expect(proponi('   ', candidati(MARES), CATALOGO)).toEqual({ tipo: 'niente' });
    expect(proponi('Quad Ci', [{ marca: 'Marca', modello: 'Inventato' }], CATALOGO)).toEqual({
      tipo: 'niente',
    });
  });

  it('sul catalogo vero: «Quad Ci» è il Mares Quad Ci fra tutti i Mares', () => {
    const mares = MODELLI_BLE.filter((v) => v.marca === 'Mares');
    expect(mares.length).toBeGreaterThan(5);
    const p = proponi('Quad Ci', candidati(mares));
    expect(p.tipo).toBe('modello');
    if (p.tipo === 'modello') expect(p.voce.modello).toBe('Quad Ci');
  });
});
