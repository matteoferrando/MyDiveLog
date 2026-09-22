/**
 * Dal nome Bluetooth al modello: le regole di `proponi`, viste rosse una per una.
 *
 * I candidati arrivano dal guscio Rust (`riconosci_computer_esterno`), che
 * interroga i filtri di libdivecomputer: sono per costruttore, e qui si
 * stringe sul modello con il catalogo. Le prove usano un catalogo finto per
 * poter costruire i casi limite, e una prova finale usa quello vero.
 */

import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { MODELLI_BLE, type VoceCatalogo } from '../src/core/ble/catalogo';
import { MARES_BLE_NATIVI, proponi, type CandidatoRiconosciuto } from '../src/core/ble/riconosci';

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
    // Il BlueLink Pro è un adattatore che si attacca a mezza gamma Mares — ma
    // non ai Mares che il Bluetooth ce l'hanno dentro: dal 22 settembre 2026
    // la scelta è fra quelli dell'adattatore soltanto. Proporre un Quad Ci a
    // chi ha un Quad col BlueLink vorrebbe dire aspettare pacchetti variabili
    // da un computer che li manda fissi. Vedi `MARES_BLE_NATIVI`.
    const p = proponi('Mares bluelink pro', candidati(MARES), CATALOGO);
    expect(p.tipo).toBe('scelta');
    if (p.tipo === 'scelta') expect(p.voci.map((v) => v.modello)).toEqual(['Quad', 'Quad Air', 'Puck Pro']);
  });

  it('fra i Mares il nome dice da che parte stare: nativi o adattatore, mai mescolati', () => {
    const tutti = MODELLI_BLE.filter((v) => v.marca === 'Mares');
    const modello = (nome: string) => {
      const p = proponi(nome, candidati(tutti));
      return p.tipo === 'modello'
        ? p.voce.modello
        : p.tipo === 'scelta'
          ? p.voci.map((v) => v.modello)
          : null;
    };
    // I nomi di `dc_filter_mares`, quelli che la libreria sa essere Mares.
    expect(modello('Mares Genius')).toBe('Genius');
    expect(modello('Sirius')).toBe('Sirius');
    expect(modello('Sirius L')).toBe('Sirius L');
    expect(modello('Quad Ci')).toBe('Quad Ci');
    expect(modello('Quad2')).toBe('Quad 2');
    expect(modello('Puck4')).toBe('Puck 4');
    expect(modello('Puck Lite')).toBe('Puck Lite');
    /*
     * ► IL CASO CHE HA FATTO NASCERE LA REGOLA. ◄ «Puck Pro U» contiene
     * «Puck Pro» — il Puck Pro vecchio, a pacchetto fisso — e la regola del
     * nome contenuto lo avrebbe proposto, o avrebbe messo il Puck Pro in una
     * scelta, a chi ha un Puck Pro Ultra, che parla a pacchetto variabile.
     */
    expect(modello('Puck Pro U')).toBe('Puck Pro Ultra');
    // «Puck» da solo è l'inizio di cinque Puck nuovi, e nessuno di quelli vecchi.
    const puck = modello('Puck');
    expect(Array.isArray(puck)).toBe(true);
    expect(puck).not.toContain('Puck Pro');
    expect(puck).not.toContain('Puck Pro +');
    expect(puck).toContain('Puck Pro Ultra');
    expect(puck).toContain('Puck 4');
    // L'adattatore: solo i Mares che senza adattatore il Bluetooth non ce l'hanno.
    const adattatore = modello('Mares bluelink pro');
    expect(Array.isArray(adattatore)).toBe(true);
    for (const nativo of ['Genius', 'Sirius', 'Quad Ci', 'Quad 2', 'Puck 4', 'Puck Pro Ultra']) {
      expect(adattatore).not.toContain(nativo);
    }
    expect(adattatore).toContain('Puck Pro');
    expect(adattatore).toContain('Quad');
  });

  it('i Mares nativi sono quelli a pacchetto variabile del ponte Rust, più il Genius', () => {
    /*
     * Due posti dicono chi è un Mares nuovo: `MARES_BLE_NATIVI` qui, per
     * numero, e `MARES_PACCHETTO_INTERO` nel ponte Rust, per nome — quello
     * decide come rimettere insieme le notifiche. Se divergessero, un Mares
     * potrebbe essere proposto come nativo e letto come vecchio, o il
     * contrario. Il Genius sta solo qui: ha il Bluetooth suo e il pacchetto
     * fisso (`ISSIRIUS` non lo nomina).
     */
    const rust = readFileSync('src-tauri/src/ponte_blec.rs', 'utf8');
    const elenco = /MARES_PACCHETTO_INTERO: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust);
    expect(elenco, 'MARES_PACCHETTO_INTERO non si trova più nel ponte').not.toBeNull();
    const nomi = [...elenco![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    const perNumero = MODELLI_BLE.filter(
      (v) => v.marca === 'Mares' && (v.numeri ?? []).some((n) => MARES_BLE_NATIVI.has(n)),
    ).map((v) => v.modello);
    expect([...perNumero].sort()).toEqual([...nomi, 'Genius'].sort());
  });

  it('halcyon mette il numero di modello dopo una H, o in mezzo a un numero lungo', () => {
    const halcyon: VoceCatalogo[] = [
      { marca: 'Halcyon', modello: 'Symbios HUD', famiglia: 'halcyon_symbios', numeri: [1] },
      { marca: 'Halcyon', modello: 'Symbios Handset', famiglia: 'halcyon_symbios', numeri: [7] },
    ];
    expect(proponi('H01A2B3C', candidati(halcyon), halcyon)).toEqual({ tipo: 'modello', voce: halcyon[0] });
    expect(proponi('H07A2B3C', candidati(halcyon), halcyon)).toEqual({ tipo: 'modello', voce: halcyon[1] });
    expect(proponi('1234071234', candidati(halcyon), halcyon)).toEqual({ tipo: 'modello', voce: halcyon[1] });
    expect(proponi('H09A2B3C', candidati(halcyon), halcyon).tipo).toBe('scelta');
  });

  it('i nomi vecchi dei Cressi che Subsurface conosce valgono quando i filtri tacciono', () => {
    // «GOA_…» e «CARESIO_…»: `btdiscovery.cpp` li riconosce, `dc_filter_cressi`
    // vuole il numero in esadecimale e non li reclama.
    const p = proponi('GOA_1a2b', []);
    expect(p.tipo === 'modello' && p.voce.modello).toBe('Goa');
    const q = proponi('CARESIO_1a2b', []);
    expect(q.tipo === 'modello' && q.voce.modello).toBe('Cartesio');
    // Ma solo quando i filtri tacciono: un altro nome senza candidati resta niente.
    expect(proponi('Cuffie di qualcuno', [])).toEqual({ tipo: 'niente' });
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
