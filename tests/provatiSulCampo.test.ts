/**
 * «MAI PROVATO SU QUESTO MODELLO» HA SMESSO DI ESSERE VERO PER UNO.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Il 17 settembre 2026, da una persona che usa l'applicazione: *«Su Mares Quad
 * Ci funziona adesso.»* È il primo computer subacqueo di terzi che ha davvero
 * consegnato immersioni attraverso libdivecomputer in questo progetto.
 *
 * Fino a quel messaggio, `Cargo.toml` diceva «il primo apparecchio vero non è
 * ancora esistito» e il selettore scriveva «mai provato» sotto ogni modello.
 * Erano vere tutte e due, e andavano scritte. *Un commento che afferma un fatto
 * va rimisurato come il fatto.*
 *
 * ► E QUESTA PROVA ESISTE PER L'ERRORE OPPOSTO. ◄ Adesso il rischio non è più
 * dire «mai provato» di qualcosa che funziona: è dire «provato» di qualcosa che
 * nessuno ha acceso. Un elenco scritto a mano ci arriva in due modi — un nome
 * digitato storto, e un modello aggiunto perché «è della stessa famiglia» — e
 * tutti e due mettono a schermo una promessa che nessuno ha fatto.
 */

import { describe, expect, it } from 'vitest';
import { PROVATI_VIA_LDC, provatoViaLdc } from '../src/core/ble/provati';
import { MODELLI_BLE } from '../src/core/ble/catalogoGenerato';

describe('l’elenco di quelli provati davvero', () => {
  it('nomina solo modelli che esistono nel catalogo', () => {
    /*
     * Un nome storto non darebbe nessun errore: semplicemente non
     * corrisponderebbe a niente, e l'etichetta resterebbe «mai provato» per
     * sempre — cioè l'elenco direbbe una cosa e lo schermo un'altra, che è il
     * modo peggiore di sbagliare perché nessuno dei due si lamenta.
     */
    for (const p of PROVATI_VIA_LDC) {
      const trovato = MODELLI_BLE.some(
        (m) =>
          m.marca.toLowerCase() === p.marca.toLowerCase() &&
          m.modello.toLowerCase() === p.modello.toLowerCase(),
      );
      expect(trovato, `«${p.marca} ${p.modello}» non è in catalogo`).toBe(true);
    }
  });

  it('e ognuno porta la data e da dove arriva la notizia', () => {
    // Fra sei mesi la domanda sarà «chi l'ha detto, e quando». La risposta deve
    // stare accanto all'affermazione, o l'affermazione non vale niente.
    for (const p of PROVATI_VIA_LDC) {
      expect(p.quando, `${p.modello}: manca la data`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.come.length, `${p.modello}: manca da dove arriva`).toBeGreaterThan(10);
    }
  });

  it('il primo è il Mares Quad Ci, e non ce ne sono di regalati', () => {
    expect(provatoViaLdc('Mares', 'Quad Ci')).toBe(true);
    expect(provatoViaLdc('mares', '  quad ci  '), 'maiuscole e spazi non contano').toBe(true);

    /*
     * ► LA METÀ CHE CONTA DI PIÙ. ◄ Lo STESSO giorno, dallo stesso programma e
     * dalla stessa libreria, un Aqualung i330R si è fermato a metà — e il
     * difetto era nostro. *Un modello provato non è una famiglia provata, e
     * nemmeno una libreria provata.*
     */
    expect(provatoViaLdc('Aqualung', 'i330R')).toBe(false);
    expect(provatoViaLdc('Mares', 'Sirius'), 'stessa marca non basta').toBe(false);
    expect(provatoViaLdc('Mares', 'Quad'), 'un nome che somiglia non basta').toBe(false);
  });
});

describe('le due etichette del selettore', () => {
  it('sono due frasi diverse, e tutte e due passano dal dizionario', async () => {
    const { readFileSync } = await import('node:fs');
    const tsx = readFileSync('src/ui/components/ScegliComputer.tsx', 'utf8');
    expect(tsx).toContain("t('via libdivecomputer, provato su questo modello')");
    expect(tsx).toContain("t('via libdivecomputer, mai provato su questo modello')");
    expect(tsx, 'l’etichetta deve dipendere dall’elenco, non da una costante').toContain(
      'provatoViaLdc(m.marca, m.modello)',
    );
  });
});
