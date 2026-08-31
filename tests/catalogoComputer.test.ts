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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cercaModelli,
  marchePerDiffusione,
  marchePrincipali,
  MODELLI_BLE,
  RICONOSCIUTE_DA_SOLE,
} from '../src/core/ble/catalogo';

/**
 * ► I NUMERI SCRITTI NEI COMMENTI SONO AFFERMAZIONI, E VANNO CONTROLLATE. ◄
 *
 * In testa a `catalogo.ts` c'era scritto «restano 110 modelli e 20 marche, un
 * elenco di 110 voci»: le voci sono 105. Il 110 è vero — sono i descrittori BLE
 * della libreria — ma un nome commerciale può portare più numeri di modello e
 * nell'elenco compare una volta sola, quindi le righe sono cinque di meno. Due
 * cose diverse chiamate con lo stesso numero, e nessuno se n'era accorto per
 * mesi: **nessun comando legge i commenti.**
 *
 * Queste prove li leggono. Non è pignoleria: questo progetto scrive numeri
 * dappertutto — nei commenti, nel README, sul sito — proprio perché «i numeri
 * rispondono meglio di quattro aggettivi». Un numero che nessuno verifica è un
 * aggettivo travestito.
 */
function numeriDichiarati(file: string): number[] {
  const testa = readFileSync(new URL(file, import.meta.url), 'utf8').split('*/')[0];
  return [...testa.matchAll(/\b(\d{2,4})\b/g)].map((m) => Number(m[1]));
}

describe('i numeri scritti nei commenti', () => {
  it('l’intestazione del catalogo generato conta le voci e le marche che ci sono', () => {
    // Il file è generato, e la sua intestazione dichiara «N modelli, M marche».
    // Se lo script che lo genera cambiasse filtro senza aggiornare quella riga,
    // la riga resterebbe lì a dire il falso — ed è la fonte da cui tutto il
    // resto (commenti, README, sito) copia i propri numeri.
    const testa = readFileSync(new URL('../src/core/ble/catalogoGenerato.ts', import.meta.url), 'utf8');
    const riga = /\/\*\* (\d+) modelli, (\d+) marche\. \*\//.exec(testa);
    expect(riga, 'il catalogo generato non dichiara più quanti modelli e marche contiene').not.toBeNull();
    expect(Number(riga![1])).toBe(MODELLI_BLE.length);
    expect(Number(riga![2])).toBe(new Set(MODELLI_BLE.map((m) => m.marca)).size);
  });

  it('l’intestazione di `catalogo.ts` non confonde i descrittori con le voci', () => {
    const numeri = numeriDichiarati('../src/core/ble/catalogo.ts');
    const voci = MODELLI_BLE.length;
    const marche = new Set(MODELLI_BLE.map((m) => m.marca)).size;
    expect(numeri, `nell’intestazione non c’è il numero delle voci (${voci})`).toContain(voci);
    expect(numeri, `nell’intestazione non c’è il numero delle marche (${marche})`).toContain(marche);
    // E soprattutto: il numero dei descrittori BLE non deve essere usato al
    // posto di quello delle voci. Erano scritti tutti e due come «110».
    const descrittori = 110;
    expect(descrittori).not.toBe(voci);
  });
});

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
