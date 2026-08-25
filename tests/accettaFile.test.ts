/**
 * Il selettore dei file non deve poter aprire la fotocamera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUESTO FILE NASCE DA UN CRASH IN REVISIONE APPLE, 25 agosto 2026, sulla
 * build 1.5.1. Il revisore ha toccato «Take Photo or Video» nel menu del
 * selettore file e l'applicazione è morta. Dal rapporto di crash:
 *
 *     namespace: TCC — "attempted to access privacy-sensitive data without a
 *     usage description ... must contain an NSCameraUsageDescription key"
 *
 * Il giorno prima `accept` era stato TOLTO su iOS, per risolvere i file
 * subacquei che nell'app File risultavano non selezionabili. La correzione
 * risolveva quel difetto e ne apriva uno peggiore: senza `accept` la WKWebView
 * assume che vada bene qualunque cosa, comprese foto e video, e offre il ramo
 * della fotocamera. Che l'app non ha, non vuole, e per cui non ha una
 * descrizione d'uso nel plist.
 *
 * Quella riga era stata cambiata senza poterla provare su un dispositivo. Il
 * test non sostituisce la prova sul telefono — nessun test qui dentro può
 * sapere cosa fa davvero WebKit — ma inchioda la CONDIZIONE che ha prodotto il
 * crash, che è l'unica parte esprimibile in codice: fra i tipi accettati non
 * devono comparire immagini o video, e `accept` non deve essere vuoto.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest';
import { accettaFile, puoAprireLaFotocamera, TIPO_QUALUNQUE_FILE } from '../src/ui/accettaFile';
import { ACCEPTED_EXTENSIONS } from '../src/core/parsers';

describe('l’attributo accept del selettore file', () => {
  it('su iOS non è mai vuoto: vuoto vuol dire «accetto anche una foto»', () => {
    /*
     * È il difetto esatto della 1.5.1. `undefined` sembra la scelta neutra —
     * «non filtro niente» — e invece è la più permissiva possibile: apre il
     * menu con la fotocamera dentro.
     */
    const valore = accettaFile(true, ACCEPTED_EXTENSIONS);
    expect(valore).not.toBe('');
    expect(valore.trim().length).toBeGreaterThan(0);
  });

  it('su iOS non dichiara nessun tipo di immagine o video', () => {
    expect(puoAprireLaFotocamera(accettaFile(true, ACCEPTED_EXTENSIONS))).toBe(false);
  });

  it('su iOS non filtra per estensione: i formati subacquei un UTI non ce l’hanno', () => {
    /*
     * L'altra metà del vincolo, ed è quella che rende il problema difficile:
     * togliere la fotocamera rimettendo le estensioni ricreerebbe il difetto
     * di partenza, cioè i file grigi nell'app File. Il valore deve stare in
     * mezzo — nessun media, e nessuna restrizione di formato.
     */
    const valore = accettaFile(true, ACCEPTED_EXTENSIONS);
    expect(valore).toBe(TIPO_QUALUNQUE_FILE);
    for (const estensione of ACCEPTED_EXTENSIONS) {
      expect(valore).not.toContain(estensione);
    }
  });

  it('sul desktop le estensioni restano: là il filtro funziona e serve', () => {
    const valore = accettaFile(false, ACCEPTED_EXTENSIONS);
    for (const estensione of ACCEPTED_EXTENSIONS) {
      expect(valore).toContain(estensione);
    }
    expect(puoAprireLaFotocamera(valore)).toBe(false);
  });

  it('il riconoscitore della fotocamera riconosce i casi che contano', () => {
    // Il guardiano va guardato: un controllo che dice sempre «va bene» non
    // protegge da niente.
    expect(puoAprireLaFotocamera(undefined)).toBe(true);
    expect(puoAprireLaFotocamera('')).toBe(true);
    expect(puoAprireLaFotocamera('image/*')).toBe(true);
    expect(puoAprireLaFotocamera('video/*')).toBe(true);
    expect(puoAprireLaFotocamera('.uddf,.jpg')).toBe(true);
    expect(puoAprireLaFotocamera('application/octet-stream')).toBe(false);
    expect(puoAprireLaFotocamera('application/json,.json')).toBe(false);
  });
});
