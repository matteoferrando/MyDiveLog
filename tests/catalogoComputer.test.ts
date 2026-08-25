/**
 * Il catalogo dei computer subacquei, e l'ordine in cui si mostra.
 *
 * PERCHÉ QUESTO FILE ESISTE. L'ordine ovvio — quello in cui la libreria elenca
 * i modelli — è esattamente quello sbagliato: mette per primo Ratio, che ha
 * venticinque modelli BLE e un subacqueo su settanta, e in fondo Suunto, che ne
 * ha quattro ed è la seconda marca più diffusa al mondo. Questi test
 * inchiodano la scelta di ordinare per DIFFUSIONE, perché è il genere di cosa
 * che qualcuno «sistema» rimettendola in ordine alfabetico.
 */

import { describe, expect, it } from 'vitest';
import {
  cercaModelli,
  marchePerDiffusione,
  marchePrincipali,
  MODELLI_BLE,
  RICONOSCIUTE_DA_SOLE,
} from '../src/core/ble/catalogo';

describe('il catalogo', () => {
  it('contiene solo modelli che parlano BLE', () => {
    /*
     * Da un telefono si raggiunge soltanto il BLE: niente seriale, niente USB,
     * e il Bluetooth classico su iOS è riservato ai profili di sistema. Un
     * modello non BLE nell'elenco è un modello che l'utente può scegliere e che
     * il telefono non contatterà mai.
     */
    expect(MODELLI_BLE.length).toBeGreaterThan(80);
    expect(MODELLI_BLE.length).toBeLessThan(200);
    for (const m of MODELLI_BLE) {
      expect(m.marca).not.toBe('');
      expect(m.modello).not.toBe('');
      expect(m.famiglia).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('non ha doppioni: marca e modello insieme identificano una voce', () => {
    const chiavi = MODELLI_BLE.map((m) => `${m.marca}|${m.modello}`);
    expect(new Set(chiavi).size).toBe(chiavi.length);
  });
});

describe('l’ordine delle marche', () => {
  it('mette per prima quella che i subacquei hanno davvero, non quella con più modelli', () => {
    const marche = marchePerDiffusione();
    expect(marche[0].marca).toBe('Shearwater');
    expect(marche[1].marca).toBe('Suunto');
  });

  it('Suunto viene prima di Ratio, che è il contrario del numero di modelli', () => {
    /*
     * IL TEST CHE DIFENDE LA DECISIONE. Ratio ha venticinque modelli BLE,
     * Suunto quattro. Ordinando per catalogo Ratio sarebbe primo. Ma Suunto è
     * la seconda marca più diffusa (20.3% dei subacquei ricreativi) e Ratio
     * l'1.3%: cinque volte più modelli, quindici volte meno gente.
     */
    const marche = marchePerDiffusione().map((m) => m.marca);
    const suunto = marche.indexOf('Suunto');
    const ratio = marche.indexOf('Ratio');
    expect(suunto).toBeLessThan(ratio);

    const modelliSuunto = MODELLI_BLE.filter((m) => m.marca === 'Suunto').length;
    const modelliRatio = MODELLI_BLE.filter((m) => m.marca === 'Ratio').length;
    expect(modelliRatio).toBeGreaterThan(modelliSuunto);
  });

  it('le marche che l’indagine non nomina finiscono in fondo, in ordine alfabetico', () => {
    /*
     * Fra due marche che nessuno ha, quella con più modelli non è più
     * probabile: è solo più prolissa. Quindi alfabetico, non per catalogo.
     */
    const marche = marchePerDiffusione().map((m) => m.marca);
    const note = marchePrincipali(100);
    const ignote = marche.slice(
      marche.findIndex((m) => !note.includes(m) && !['Divesoft', 'Sherwood', 'Ratio'].includes(m)),
    );
    const ordinate = [...ignote].sort((a, b) => a.localeCompare(b));
    expect(ignote).toEqual(ordinate);
  });

  it('dice quali marche l’applicazione riconosce da sola', () => {
    // Sono i due driver scritti in casa, e da soli coprono il 57% dei
    // subacquei ricreativi e l'80% di quelli tecnici: il selettore serve per
    // il resto, ed è la ragione per cui non va messo davanti a tutti.
    const automatiche = marchePerDiffusione()
      .filter((m) => m.automatica)
      .map((m) => m.marca);
    expect(automatiche).toContain('Shearwater');
    expect(automatiche).toContain('Scubapro');
    expect(RICONOSCIUTE_DA_SOLE).toContain('Uwatec');
  });

  it('poche marche coprono quasi tutti', () => {
    const principali = marchePrincipali(90);
    expect(principali.length).toBeLessThanOrEqual(8);
    expect(principali[0]).toBe('Shearwater');
  });
});

describe('la ricerca', () => {
  it('trova per nome del modello, che è la strada di chi sa cosa ha al polso', () => {
    const trovati = cercaModelli('perdix');
    expect(trovati.length).toBeGreaterThan(0);
    expect(trovati.every((m) => m.marca === 'Shearwater')).toBe(true);
  });

  it('trova per marca', () => {
    expect(cercaModelli('cressi').every((m) => m.marca === 'Cressi')).toBe(true);
  });

  it('non restituisce tutto quando non si cerca niente', () => {
    // Una ricerca vuota che restituisce l'intero catalogo trasforma il campo di
    // ricerca in un elenco di centodieci voci appena lo si tocca.
    expect(cercaModelli('')).toEqual([]);
    expect(cercaModelli('   ')).toEqual([]);
  });
});
